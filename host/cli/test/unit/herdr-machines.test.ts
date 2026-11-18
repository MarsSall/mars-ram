import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enabledHerdrMachines, parseHerdrMachines, runHerdr, type ProcessRunner } from '../../src/core/herdr-switcher.ts';
import { checkHerdrMachines, diagnose, type DoctorPorts } from '../../src/core/doctor.ts';
import { createDoctorAdapter, type DoctorIO } from '../../src/adapters/doctor.ts';
import { doctorCommand } from '../../src/doctor-command.ts';

const beelink = '724fc7fdc263efd340c71af4e6e57e2b\tBeelink\tmars@100.64.0.10\tdefault\tenabled';

describe('herdr machine list parser', () => {
 it('reads enabled and disabled saved machines from the tab-separated output', () => {
  expect(parseHerdrMachines(`${beelink}\nabc123\tOld box\tme@10.0.0.2\twork\tdisabled\n`)).toEqual([
   { label: 'Beelink', enabled: true },
   { label: 'Old box', enabled: false },
  ]);
  expect(enabledHerdrMachines(`${beelink}\r\nabc123\tOld box\tme@10.0.0.2\twork\tdisabled\r\n`)).toEqual(['Beelink']);
 });
 it('returns nothing for empty output', () => {
  expect(parseHerdrMachines('')).toEqual([]);
  expect(enabledHerdrMachines('\n')).toEqual([]);
 });
 it.each([
  'Beelink enabled',
  '724fc7\tBeelink\tmars@host\tdefault',
  '724fc7\tBeelink\tmars@host\tdefault\tenabled\textra',
  '724fc7\tBeelink\tmars@host\tdefault\tENABLED',
  '724fc7\tBeelink\tmars@host\tdefault\tyes',
  '\tBeelink\tmars@host\tdefault\tenabled',
  '72;rm\tBeelink\tmars@host\tdefault\tenabled',
  '724fc7\t   \tmars@host\tdefault\tenabled',
  '724fc7\tBeelink\t\tdefault\tenabled',
  '{"result":{"machines":[]}}',
 ])('ignores the malformed line %j', line => {
  expect(parseHerdrMachines(`${line}\n${beelink}`)).toEqual([{ label: 'Beelink', enabled: true }]);
 });
 it('sanitizes and caps labels for display, deduplicates and caps the list', () => {
  const [machine] = parseHerdrMachines(`abc\tBee\x1b[31mlink\x07 ${'x'.repeat(200)}\tme@h\ts\tenabled`);
  expect(machine!.label).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  expect(machine!.label.startsWith('Bee[31mlink x')).toBe(true);
  expect(machine!.label.length).toBeLessThanOrEqual(64);
  const many = Array.from({ length: 40 }, (_, i) => `id${i}\tBox ${i}\tme@h\ts\tenabled`);
  expect(enabledHerdrMachines([beelink, beelink, ...many].join('\n'))).toHaveLength(16);
  expect(enabledHerdrMachines(`${beelink}\n${beelink.replace('724f', '999f')}`)).toEqual(['Beelink']);
  expect(enabledHerdrMachines(' '.repeat(70_000) + `\n${beelink}`)).toEqual([]);
 });
});

class Fake {
 machines: string | Error = '';
 calls: (readonly string[])[] = [];
 run: ProcessRunner = async (file, args) => {
  this.calls.push(args);
  if (args[0] === 'machine') { if (this.machines instanceof Error) throw this.machines; return this.machines; }
  if (file === 'git') return 'main\n';
  return JSON.stringify({ result: args[0] === 'workspace' ? { workspaces: [{ workspace_id: 'wX', label: 'WindowsOS', focused: true, agent_status: 'idle' }] } : args[0] === 'tab' ? { tabs: [] } : { panes: [] } });
 };
}

describe('mars-ram herdr list machines field', () => {
 const list = (f: Fake) => runHerdr(['list'], { run: f.run, binary: 'herdr' });
 it('reports the enabled saved machine labels', async () => {
  const f = new Fake(); f.machines = `${beelink}\nabc\tOld\tme@h\ts\tdisabled\n`;
  expect(await list(f)).toEqual({ version: 1, truncated: false, workspaces: [expect.objectContaining({ id: 'wX' })], machines: ['Beelink'] });
  expect(f.calls).toContainEqual(['machine', 'list']);
 });
 it.each([
  ['no machines', ''],
  ['only disabled machines', 'abc\tOld\tme@h\ts\tdisabled\n'],
  ['a failing machine list', Object.assign(Error('unknown subcommand'), { code: 1 })],
  ['an older Herdr without machine list', Object.assign(Error('missing'), { code: 'ENOENT' })],
 ])('keeps the previous output unchanged with %s', async (_, machines) => {
  const f = new Fake(); f.machines = machines;
  const result = await list(f);
  expect(result).toEqual({ version: 1, truncated: false, workspaces: [{ id: 'wX', label: 'WindowsOS', focused: true, status: 'idle', branch: null, tabs: [] }] });
  expect('machines' in result).toBe(false);
 });
 it('does not ask for machines when focusing', async () => {
  const f = new Fake(); f.machines = beelink;
  expect(await runHerdr(['focus', 'wX'], { run: f.run, binary: 'herdr' })).toEqual({ version: 1, ok: true });
  expect(f.calls).not.toContainEqual(['machine', 'list']);
 });
});

function ports(overrides: Partial<DoctorPorts> = {}): DoctorPorts {
 return {
  platform: 'linux', spanish: false, herdr: async () => true, herdrMachines: async () => [],
  cli: async () => ({ resolved: true, command: '/home/alex/.local/bin/mars-ram', current: true, localBin: true }),
  linkServer: async () => ({ present: true, current: true, configured: true, validLinks: 0, listener: false }),
  piVersion: async () => 'pi 1.2.0', installation: async () => ({ present: true, current: true, homes: [{ path: '/pi', registered: true }] }),
  registry: async () => ({ exists: true, entries: [{ name: 'live.json', pid: 10 }], directoryMode: 0o700, modes: [0o600] }),
  alive: () => true, acl: async () => ({ safe: true, administratorOwner: false }), keyLocks: async () => [],
  tailscale: async () => '100.64.0.1', zerotier: async () => [], zeroTierInterfaces: async () => [], firewall: async () => ({ ufw: 'inactive', firewalld: 'inactive' }), forwarding: async () => ({ allowed: true, keysAllowed: true }),
  windows: async () => ({ service: true, shell: 'cmd' }),
  uploads: async () => ({ state: { ok: true, path: '/tmp/mars-ram-1000/uploads' }, legacy: false }), ...overrides,
 };
}
const printed = async (p: DoctorPorts) => { const lines: string[] = []; const code = await doctorCommand(p, line => lines.push(line)); return { code, lines }; };

describe('doctor Herdr saved machines', () => {
 it('warns in English naming the enabled machines and how to hide them', async () => {
  expect(await checkHerdrMachines(ports({ herdrMachines: async () => ['Beelink', 'Old box'] }))).toEqual([{
   status: 'warning',
   finding: "Herdr also shows the workspaces of its saved machines: Beelink, Old box. The phone's terminal on this computer shows them too.",
   fix: 'To hide them: herdr machine disable Beelink; herdr machine disable "Old box"',
  }]);
 });
 it('warns in Spanish', async () => {
  expect(await checkHerdrMachines(ports({ spanish: true, herdrMachines: async () => ['Beelink'] }))).toEqual([{
   status: 'warning',
   finding: 'Herdr también muestra los espacios de sus máquinas guardadas: Beelink. La terminal del teléfono en esta computadora también los muestra.',
   fix: 'Para ocultarlos: herdr machine disable Beelink',
  }]);
 });
 it('prints one warning line and keeps doctor successful', async () => {
  const { code, lines } = await printed(ports({ herdrMachines: async () => ['Beelink'] }));
  expect(code).toBe(0);
  expect(lines.filter(line => line.includes('Beelink'))).toEqual(["warning: Herdr also shows the workspaces of its saved machines: Beelink. The phone's terminal on this computer shows them too. To hide them: herdr machine disable Beelink"]);
 });
 it('keeps the previous doctor output unchanged with no machines, missing Herdr or a failing command', async () => {
  const before = await printed(ports());
  for (const herdrMachines of [async () => [], async () => { throw Error('ENOENT'); }]) {
   const after = await printed(ports({ herdrMachines }));
   expect(after).toEqual(before);
   expect(after.lines.some(line => /machine|máquina/.test(line))).toBe(false);
  }
  expect((await diagnose(ports({ herdrMachines: async () => { throw Error('boom'); } }))).results.some(r => r.status === 'problem')).toBe(false);
 });
});

describe('doctor adapter Herdr saved machines', () => {
 function adapter(home: string, outputs: Record<string, string>, hostJson?: string) {
  const calls: string[][] = [];
  const io: DoctorIO = {
   run(command, args) { calls.push([command, ...args]); const value = outputs[[command, ...args].join(' ')]; if (value === undefined) throw Error('unavailable'); return value; },
   read(path) { return path === join(home, '.mars-ram', 'host.json') ? hostJson : undefined; },
   list: () => [], mode: () => 0o700,
  };
  return { ports: createDoctorAdapter({ home, platform: 'linux', io }), calls };
 }
 it('runs machine list on the recorded Herdr and reports enabled labels', async () => {
  const home = mkdtempSync(join(tmpdir(), 'herdr-machines-'));
  try {
   mkdirSync(join(home, '.mars-ram'));
   const herdr = join(home, 'herdr'); writeFileSync(herdr, 'never execute'); chmodSync(herdr, 0o700);
   const a = adapter(home, { [`${herdr} machine list`]: `${beelink}\n` }, JSON.stringify({ herdr }));
   expect(await a.ports.herdrMachines()).toEqual(['Beelink']);
   expect(a.calls).toEqual([[herdr, 'machine', 'list']]);
   const failing = adapter(home, {}, JSON.stringify({ herdr }));
   expect(await failing.ports.herdrMachines()).toEqual([]);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
 it('never runs anything when Herdr is not recorded or missing', async () => {
  for (const hostJson of [undefined, 'bad json', '{}', JSON.stringify({ herdr: '/missing/herdr' })]) {
   const a = adapter('/fixture', {}, hostJson);
   expect(await a.ports.herdrMachines()).toEqual([]);
   expect(a.calls).toEqual([]);
  }
 });
});
