import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { en } from '../src/ui/i18n/en';
import { es } from '../src/ui/i18n/es';
import { HostUpdateNotice } from '../src/ui/host-update-notice';
vi.mock('../src/ui/install-help', () => ({ CommandBlock: 'CommandBlock' }));
vi.mock('../src/ui/preferences', () => ({ usePreferences: () => ({ t: en, theme: { touch: 48, spacing: (n: number) => n * 4, font: { mono: 'mono' }, colors: { danger: 'red', textMuted: 'gray' } } }) }));
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
