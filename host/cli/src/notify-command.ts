import { homedir } from 'node:os';
import { join } from 'node:path';
import { runNotify, registrationAddress } from './core/notify.ts';
import { readHostIdentity } from './adapters/host-identity.ts';

export async function notifyCommand(args: string[]): Promise<number> {
 let result: Awaited<ReturnType<typeof runNotify>>;
 try {
 const root = join(homedir(), '.mars-ram');
 const { createNotifyStore } = await import('../../link-server/src/adapters/notify-store.ts');
 const { createLauncher } = await import('../../link-server/src/adapters/launcher.ts');
 const { tailscale } = await import('../../link-server/src/adapters/tailscale.ts');
 const { DEFAULT_PORT } = await import('../../link-server/src/core/links.ts');
 result = await runNotify(args, {
  address: () => registrationAddress(process.env),
  hostKeyId: () => { const identity = readHostIdentity(); if (!identity.ok) throw Error(); return identity.fingerprint; },
  readInput: async () => {
   let text = ''; const timeout = setTimeout(() => process.stdin.destroy(Error('Input timeout.')), 5000);
   try { for await (const chunk of process.stdin) { text += chunk.toString(); if (Buffer.byteLength(text) > 1024) throw Error(); } return text; }
   finally { clearTimeout(timeout); }
  },
  store: createNotifyStore(join(root, 'notify')),
  ensure: async () => {
   const launcher = createLauncher(join(root, 'links'), join(root, 'link-server', 'src', 'main.ts'));
   const address = await tailscale.address();
   if (!await launcher.isRunning(DEFAULT_PORT, address)) await launcher.start(DEFAULT_PORT, address);
  },
 });
 } catch { result = { v: 1, ok: false, code: 'NOTIFY_FAILED' }; }
 process.stdout.write(JSON.stringify(result) + '\n');
 return result.ok ? 0 : 1;
}
