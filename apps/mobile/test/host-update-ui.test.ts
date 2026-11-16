import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { en } from '../src/ui/i18n/en';
import { es } from '../src/ui/i18n/es';
import { HostUpdateNotice } from '../src/ui/host-update-notice';
vi.mock('../src/ui/install-help', () => ({ CommandBlock: 'CommandBlock' }));
const strings = vi.hoisted(() => ({ t: undefined as unknown }));
vi.mock('../src/ui/preferences', () => ({ usePreferences: () => ({ t: strings.t ?? en, theme: { touch: 48, spacing: (n: number) => n * 4, font: { mono: 'mono' }, colors: { danger: 'red', textMuted: 'gray' } } }) }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable' }));
// Inspect the small presentational tree without loading native React Native.
function flatten(value: any): any[] {
 if (Array.isArray(value)) return value.flatMap(flatten);
 return value && typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [value];
}
it('shows no notice for ok/unknown, makes required prominent and soft subtle, and copies only pinned commands', async () => {
 expect(HostUpdateNotice({ update: { release: 'dev', status: 'ok' } })).toBeNull();
 expect(HostUpdateNotice({})).toBeNull();
 for (const status of ['required', 'soft'] as const) {
  const nodes = flatten(HostUpdateNotice({ update: { release: '0.1.5', status, target: '0.1.6' } }));
  expect(nodes).toContain(status === 'required' ? en.hostUpdate.required : en.hostUpdate.soft);
  expect(nodes.some(n => n?.props?.style?.color === (status === 'required' ? 'red' : 'gray'))).toBe(true);
  expect(nodes).toContain(en.hostUpdate.terminal);
  const copy = nodes.find(n => n?.type === 'CommandBlock');
  expect(copy.props.command).toBe('pnpm add -g mars-ram@0.1.6\nmars-ram install');
 }
});
it('wires notices to both approved locations and provides English and Spanish reload/remediation copy', () => {
 for (const file of ['../src/app/(tabs)/computers.tsx', '../src/app/(tabs)/index.tsx']) {
  expect(readFileSync(new URL(file, import.meta.url), 'utf8')).toContain('<HostUpdateNotice');
 }
 for (const strings of [en, es]) {
  expect(strings.hostUpdate.required).toBeTruthy(); expect(strings.hostUpdate.soft).toBeTruthy();
  expect(strings.hostUpdate.terminal).toBeTruthy(); expect(strings.hostUpdate.reload).toContain('/reload');
 }
 expect(es.hostUpdate.reload).toBe('Escribí /reload en esta sesión para usar lo nuevo');
 expect(readFileSync(new URL('../src/app/(tabs)/index.tsx', import.meta.url), 'utf8')).toContain('session.reloadNeeded');
});
it('S7: a host with mars-ram update gets that command; an older host the manual commands with the normal-terminal line, in English and Spanish', () => {
 for (const t of [en, es]) {
  strings.t = t;
  const current = flatten(HostUpdateNotice({ update: { release: '0.1.7', status: 'soft', target: '0.1.8' } }));
  expect(current.find(n => n?.type === 'CommandBlock').props.command).toBe('mars-ram update');
  expect(current).toContain(t.hostUpdate.terminalOne);
  expect(current).not.toContain(t.hostUpdate.terminal);
  expect(current).not.toContain(t.hostUpdate.manual);
  const old = flatten(HostUpdateNotice({ update: { release: '0.1.5', status: 'required', target: '0.1.6' } }));
  expect(old.find(n => n?.type === 'CommandBlock').props.command).toBe('pnpm add -g mars-ram@0.1.6\nmars-ram install');
  expect(old).toContain(t.hostUpdate.terminal);
  expect(old).toContain(t.hostUpdate.manual);
  expect(old).not.toContain(t.hostUpdate.terminalOne);
 }
 strings.t = undefined;
 expect(es.hostUpdate.manual).toContain('en una terminal normal, no de administrador');
 expect(es.hostUpdate.manual).toBe('Hacelo en una terminal normal, no de administrador, y escribí los dos comandos de a uno: cada uno en su línea, con Enter al final.');
 expect(en.hostUpdate.manual).toBe('Use a normal terminal, not an administrator one, and type the two commands one at a time: each on its own line, pressing Enter after each.');
 expect(es.hostUpdate.terminalOne).toBe('Ejecutá este comando en la terminal de la computadora (Linux o Windows):');
 expect(en.hostUpdate.terminalOne).toBe('Run this command in the computer’s terminal (Linux or Windows):');
});
