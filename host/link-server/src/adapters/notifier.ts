import { randomBytes } from 'node:crypto';
import { readdir, lstat } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { noticeBridge, noticeEnvelope, noticeSnapshot, noticeEvent, type NoticeBridge as RegistryEntry } from '../../../../packages/protocol/src/notice-bridge.ts';
import { signNotice } from '../../../../packages/protocol/src/session-notice.ts';
import { NoticeRules, deliverNotice } from '../core/notifier.ts';
import { readRegular } from './file-store.ts';
import { createNotifyStore } from './notify-store.ts';

export function tcpNotice(address: string, port: number, line: string, timeoutMs: number): Promise<void> {
 return new Promise((resolve, reject) => {
  const socket = connect({ host: address, port });
  const timer = setTimeout(() => socket.destroy(Error('Notice timeout.')), timeoutMs);
  socket.once('close', () => clearTimeout(timer));
  socket.once('error', () => reject(Error('Notice delivery failed.')));
  socket.once('connect', () => socket.end(line, () => { socket.destroy(); resolve(); }));
 });
}
/** Bounded SSE frames; no agent text is retained beyond one frame or leaves this adapter. */
export async function* boundedLines(body: ReadableStream<Uint8Array>, signal: AbortSignal, limit: number): AsyncGenerator<string> {
 const reader = body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
 let line = '', size = 0;
 try {
  while (!signal.aborted) {
   const chunk = await reader.read(); if (chunk.done) break;
   let offset = 0;
   while (offset < chunk.value.length) {
    const newline = chunk.value.indexOf(10, offset);
    const end = newline < 0 ? chunk.value.length : newline;
    size += end - offset + (newline < 0 ? 0 : 1);
    if (size > limit) throw Error('Oversized event.');
    line += decoder.decode(chunk.value.subarray(offset, end), { stream: true });
    if (newline >= 0) { line += decoder.decode(); yield line.replace(/\r$/, ''); line = ''; size = 0; }
    offset = end + 1;
   }
  }
  line += decoder.decode();
  if (line) yield line;
 } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function startNotifier(root: string) {
 const registrations = createNotifyStore(join(root, 'notify'));
 const rules = new NoticeRules();
 const controller = new AbortController();
 const jobs = new Map<string, { abort: AbortController; done: Promise<void>; identity: string }>();
 const deliveries = new Set<Promise<void>>();
 let polling = false;
 const signal = controller.signal;
 async function send(entry: RegistryEntry, seq: number, kind: 'finished' | 'failed' | 'needs-answer') {
  // No queue: at most 16 notice fan-outs; each uses at most four sockets in parallel.
  if (deliveries.size >= 16 || signal.aborted) return;
  const task = (async () => {
   const phones = await registrations.all(); let index = 0;
   await Promise.all(Array.from({ length: Math.min(4, phones.length) }, async () => {
    while (!signal.aborted && index < phones.length) {
     const phone = phones[index++]!;
     // Basename for both Unix and Windows bridges; signing rejects control chars/oversized names.
     const project = entry.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || 'project';
     const line = await signNotice({ v: 1, hostKeyId: phone.hostKeyId, bridgeInstanceId: entry.bridgeInstanceId, project, kind, seq, sentAt: Date.now(), nonce: randomBytes(16).toString('hex') }, phone.secret);
     await deliverNotice(line, { send: (data, timeout) => signal.aborted ? Promise.reject(Error()) : tcpNotice(phone.address, phone.port, data, timeout), sleep: ms => sleep(ms, undefined, { signal }) });
    }
   }));
  })().catch(() => {});
  deliveries.add(task); void task.finally(() => deliveries.delete(task));
 }
 async function watch(entry: RegistryEntry, abort: AbortController) {
  const id = entry.bridgeInstanceId; let seq = 0, initialized = false;
  const envelope = (json: unknown) => noticeEnvelope(json, entry);
  async function request(path: string) {
   const response = await fetch(`http://127.0.0.1:${entry.port}${path}`, { headers: { Authorization: `Bearer ${entry.token}` }, redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) });
   if (!response.ok || !response.body) { await response.body?.cancel(); throw Error(); }
   return response;
  }
  while (!abort.signal.aborted) {
   try {
    if (!initialized) {
     const state = await request('/state');
     let text = '';
     for await (const line of boundedLines(state.body!, abort.signal, 65536)) {
      text += line;
      if (Buffer.byteLength(text) > 65536) throw Error();
     }
     const lastSeq = noticeSnapshot(JSON.parse(text), entry);
     if (lastSeq === null) throw Error();
     seq = lastSeq; rules.snapshot(id, seq, entry.protocolVersion); initialized = true;
    }
    const response = await request(`/events?since=${seq}`);
    let data = '', event = '', replay = false;
    for await (const line of boundedLines(response.body!, abort.signal, 1_048_576)) {
     if (!line) {
      if (data) {
       const json = JSON.parse(data);
       if (event === 'replay') {
        if (!envelope(json) || typeof json.gap !== 'boolean') throw Error();
        if (json.gap) { initialized = false; throw Error(); }
        replay = true;
       } else {
        if (!replay) throw Error();
        const decoded = noticeEvent(json);
        if (!decoded) throw Error();
        if (decoded.seq > seq) {
         const kind = rules.event(id, decoded.seq, decoded.type, decoded.outcome, decoded.aborted);
         seq = decoded.seq;
         if (kind) void send(entry, seq, kind);
        }
       }
      }
      data = ''; event = '';
     } else if (line.startsWith('event:')) event = line.slice(6).trim();
     else if (line.startsWith('data:')) { data += line.slice(5).trimStart(); if (data.length > 1_048_576) throw Error(); }
    }
   } catch { /* Offline, gap or invalid data: bounded retry; never print credentials or payloads. */ }
   await sleep(2000, undefined, { signal: abort.signal }).catch(() => {});
  }
 }
 async function poll() {
  if (polling || signal.aborted) return;
  polling = true;
  try {
   const directory = join(root, 'bridges');
   const files = await readdir(directory);
   if (files.length > 1000) throw Error();
   const found = new Map<string, RegistryEntry>();
   if ((await registrations.all()).length) for (const file of files) {
    if (!/^[A-Za-z0-9._-]+\.json$/.test(file) || file === '..') continue;
    try {
     const path = join(directory, file), info = await lstat(path);
     if (process.platform !== 'win32' && (info.uid !== process.getuid?.() || (info.mode & 0o077))) continue;
     const decoded = noticeBridge(JSON.parse((await readRegular(path, 65536)).toString('utf8')));
     if (!decoded || /[\r\n]/.test(decoded.token)) continue;
     try { process.kill(decoded.pid, 0); } catch { continue; }
     found.set(decoded.bridgeInstanceId, decoded);
    } catch { /* Untrusted, stale or disappearing registry entries do not start a watch. */ }
   }
   for (const [id, job] of jobs) if (!found.has(id) || JSON.stringify(found.get(id)) !== job.identity) {
    job.abort.abort(); await job.done; jobs.delete(id); rules.remove(id);
   }
   for (const [id, entry] of found) if (!signal.aborted && !jobs.has(id) && jobs.size < 128) {
    const abort = new AbortController();
    jobs.set(id, { abort, identity: JSON.stringify(entry), done: watch(entry, abort).catch(() => {}) });
   }
  } catch { /* Discovery failure must not interrupt the link server's existing duties. */ }
  finally { polling = false; }
 }
 const timer = setInterval(() => { void poll(); }, 30_000); void poll();
 return { async close() { controller.abort(); clearInterval(timer); for (const job of jobs.values()) job.abort.abort(); await Promise.all([...jobs.values()].map(job => job.done)); await Promise.all(deliveries); } };
}
