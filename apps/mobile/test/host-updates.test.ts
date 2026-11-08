import { expect, it } from 'vitest';
import { HostUpdates, LatestHostRelease, DAY_MS } from '../src/core/host-updates';
import { FakeHostReleaseRegistry, FakeHostReleaseCache } from './fake-host-releases';
import { savedHost } from './fakes';

function setup() {
 let now = 100_000, connectionId = 'ssh1', execs = 0;
 let result = { ok: true as const, stdout: '{"version":1,"release":"0.1.4"}', stderr: '', exitStatus: 0 };
 const registry = new FakeHostReleaseRegistry(), cache = new FakeHostReleaseCache();
 const latest = new LatestHostRelease({ registry, cache, clock: () => now });
 const updates = new HostUpdates({ latest, clock: () => now, connections: { connection: async () => ({ ok: true, connectionId }) }, host: {
  readFile: async () => ({ ok: true, content: '{"node":"/usr/bin/node","cli":"/home/me/cli/src/main.ts"}' }),
  exec: async (_id, command) => { expect(command).toBe("'/usr/bin/node' '/home/me/cli/src/main.ts' version --json"); execs++; return result; },
 } });
 return { registry, cache, latest, updates, execs: () => execs, advance: (ms: number) => { now += ms; }, reconnect: () => { connectionId = 'ssh2'; }, respond: (r: typeof result) => { result = r; } };
}
it('checks once per shared connection, caps focus refreshes to 10 seconds, deduplicates and caches per host', async () => {
 const f = setup(); const a = savedHost('a');
 expect((await Promise.all([f.updates.check(a), f.updates.check(a)]))[0]).toMatchObject({ release: '0.1.4', status: 'ok' });
 expect(f.execs()).toBe(1);
 await f.updates.check(a); expect(f.execs()).toBe(1);
 await f.updates.check(savedHost('b')); expect(f.execs()).toBe(2);
 f.advance(10_000); await f.updates.check(a); expect(f.execs()).toBe(3);
 f.reconnect(); await f.updates.check(a); expect(f.execs()).toBe(4);
 f.updates.retain([]); expect(f.updates.cached(a.id)).toBeUndefined();
});
it('does not let an older connection overwrite the newer connection cache when its probe arrives late', async () => {
 const f = setup(); let finishOld!: (value: any) => void; let connectionId = 'old';
 const oldResult = new Promise<any>(resolve => { finishOld = resolve; });
 const updates = new HostUpdates({ latest: f.latest, clock: () => 0,
  connections: { connection: async () => ({ ok: true, connectionId }) },
  host: { readFile: async () => ({ ok: true, content: '{"node":"/usr/bin/node","cli":"/home/me/main.ts"}' }),
   exec: async id => id === 'old' ? oldResult : { ok: true, stdout: '{"version":1,"release":"0.1.4"}', stderr: '', exitStatus: 0 } },
 });
 const old = updates.check(savedHost('a'));
 await Promise.resolve();
 connectionId = 'new';
 await updates.check(savedHost('a'));
 finishOld({ ok: true, stdout: 'usage', stderr: '', exitStatus: 2 });
 expect(await old).toEqual({ release: '0.1.4', status: 'ok' });
 expect(updates.cached('a')).toEqual({ release: '0.1.4', status: 'ok' });
});
it('legacy usage/nonzero exit warns, while malformed success is unknown and never fails sessions', async () => {
 const f = setup(), a = savedHost('a');
 f.respond({ ok: true, stdout: 'usage', stderr: '', exitStatus: 2 });
 expect(await f.updates.check(a)).toEqual({ release: 'missing', status: 'required', target: '0.1.4' });
 f.advance(10_000); f.respond({ ok: true, stdout: 'bad json', stderr: '', exitStatus: 0 });
 expect(await f.updates.check(a)).toEqual({ release: 'unknown', status: 'ok' });
});
it('npm is daily across new service instances, failures included, concurrent calls share one attempt', async () => {
 const f = setup();
 f.registry.value = '0.1.5';
 expect(await Promise.all([f.latest.get(), f.latest.get()])).toEqual(['0.1.5', '0.1.5']);
 expect(f.registry.calls).toBe(1); expect(f.cache.value).toEqual({ checkedAt: 100_000, latest: '0.1.5' });
 const reopened = new LatestHostRelease({ registry: f.registry, cache: f.cache, clock: () => 100_001 });
 expect(await reopened.get()).toBe('0.1.5'); expect(f.registry.calls).toBe(1);
 f.advance(DAY_MS); f.registry.fail = true;
 expect(await f.latest.get()).toBe('0.1.5'); expect(f.registry.calls).toBe(2);
 await f.latest.get(); expect(f.registry.calls).toBe(2);
});
it('skips the request when its daily attempt cannot be persisted', async () => {
 const f = setup();
 f.cache.write = async () => { throw Error('storage unavailable'); };
 expect(await f.latest.get()).toBeUndefined();
 expect(await f.latest.get()).toBeUndefined();
 expect(f.registry.calls).toBe(0);
});
it('does not turn transport, missing record or unsafe path failures into legacy host warnings', async () => {
 const f = setup();
 for (const content of [undefined, '{"node":"/usr/bin/node;evil","cli":"/home/me/main.ts"}', '{"node":"/usr/bin/node","cli":"/home/me/main.ts"}']) {
  const updates = new HostUpdates({ latest: f.latest, clock: () => 0,
   connections: { connection: async () => ({ ok: true, connectionId: 'ssh' }) },
   host: { readFile: async () => content === undefined ? { ok: false, code: 'NOT_FOUND', message: 'private' } : { ok: true, content },
    exec: async () => ({ ok: false, code: 'UNREACHABLE', message: 'private details' }) },
  });
  expect(await updates.check(savedHost('a'))).toEqual({ release: 'unknown', status: 'ok' });
 }
});
it('bad npm metadata and offline are silent, never supply executable targets or override minimum', async () => {
 const f = setup(); f.registry.value = '0.1.5;curl evil';
 expect(await f.latest.get()).toBeUndefined();
 expect(await f.updates.check(savedHost('a'))).toEqual({ release: '0.1.4', status: 'ok' });
 f.advance(DAY_MS); f.registry.value = '0.1.5';
 expect(await f.updates.check(savedHost('a'))).toEqual({ release: '0.1.4', status: 'soft', target: '0.1.5' });
 const offline = setup(); offline.registry.fail = true;
 expect(await offline.latest.get()).toBeUndefined();
 expect(await offline.latest.get()).toBeUndefined(); expect(offline.registry.calls).toBe(1);
});
it('snapshot returns cached statuses at once and never waits for a slow probe', async () => {
 const never = new Promise<never>(() => {});
 const updates = new HostUpdates({ latest: { get: () => never } as unknown as LatestHostRelease, clock: () => 0,
  connections: { connection: async () => ({ ok: true, connectionId: 'c' }) },
  host: { readFile: () => never, exec: () => never } });
 const result = await Promise.race([Promise.resolve(updates.snapshot([savedHost('a')])), new Promise(resolve => setTimeout(() => resolve('blocked'), 50))]);
 expect(result).toEqual({});
});
