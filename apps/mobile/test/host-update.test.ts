import { expect, it } from 'vitest';
import { compareSemver, hostUpdateStatus, parseHostVersion, buildVersionCommand, MINIMUM_HOST_VERSION, needsBridgeReload, updateCommand } from '../src/core/host-update';

it('parses only bounded v1 release JSON; dev is explicitly non-release', () => {
 expect(parseHostVersion('{"version":1,"release":"0.1.4"}\n')).toBe('0.1.4');
 expect(parseHostVersion('{"version":1,"release":"dev"}')).toBe('dev');
 for (const text of ['{}', 'usage', '{"version":2,"release":"0.1.4"}', '{"version":1,"release":"0.1.4;evil"}', ' '.repeat(1025)]) expect(parseHostVersion(text)).toBe('unknown');
});
it('compares semantic versions numerically including prereleases and build metadata', () => {
 for (const [a, b] of [['0.1.9', '0.1.10'], ['1.0.0-alpha', '1.0.0-alpha.1'], ['1.0.0-alpha.2', '1.0.0-alpha.10'], ['1.0.0-2', '1.0.0-alpha'], ['1.0.0-rc.1', '1.0.0']]) {
  expect(compareSemver(a!, b!)).toBe(-1); expect(compareSemver(b!, a!)).toBe(1);
 }
 expect(compareSemver('1.0.0+one', '1.0.0+two')).toBe(0);
 for (const bad of ['01.0.0', '1.0', 'v1.0.0', '1.0.0-01', '1.0.0;echo', '999999999999999999999.0.0']) expect(compareSemver(bad, '1.0.0')).toBeNull();
});
it('prioritizes minimum over npm; missing is legacy, dev and unknown never warn', () => {
 expect(MINIMUM_HOST_VERSION).toBe('0.1.6');
 expect(hostUpdateStatus('0.1.5', MINIMUM_HOST_VERSION, '0.1.6')).toBe('required');
 expect(hostUpdateStatus('0.1.6', MINIMUM_HOST_VERSION, '0.1.6')).toBe('ok');
 expect(hostUpdateStatus('missing', MINIMUM_HOST_VERSION)).toBe('required');
 expect(hostUpdateStatus('0.1.3', '0.1.4', '0.1.5')).toBe('required');
 expect(hostUpdateStatus('missing', '0.1.4')).toBe('required');
 expect(hostUpdateStatus('missing', '0.1.3')).toBe('ok');
 expect(hostUpdateStatus('0.1.4', '0.1.4', '0.1.5')).toBe('soft');
 for (const release of ['dev', 'unknown', null, 'garbage', '0.1.5']) expect(hostUpdateStatus(release, '0.1.4', '0.1.5')).toBe('ok');
 expect(hostUpdateStatus('0.1.4', '0.1.4', 'malicious')).toBe('ok');
});
it('uses the switcher path validation and platform quoting for the fixed version command', () => {
 expect(buildVersionCommand({ node: '/usr/bin/node', cli: '/home/me/host cli/main.ts' })).toBe("'/usr/bin/node' '/home/me/host cli/main.ts' version --json");
 expect(buildVersionCommand({ node: 'C:\\Program Files\\node.exe', cli: 'C:\\host cli\\main.ts' })).toBe('"C:\\Program Files\\node.exe" "C:\\host cli\\main.ts" version --json');
 for (const node of ['/bin/$(node)', '/bin/../node', '/bin/node\n', 'C:\\node.exe']) expect(() => buildVersionCommand({ node, cli: '/home/me/main.ts' })).toThrow();
});
it('offers only validated pinned update targets and hints only for older compatible protocol minors', () => {
 expect(updateCommand('0.1.4')).toBe('pnpm add -g mars-ram@0.1.4\nmars-ram install');
 expect(() => updateCommand('0.1.4;evil')).toThrow();
 expect(needsBridgeReload('1.1', '1.2')).toBe(true);
 for (const version of ['1.2', '1.3', '2.0', 'unknown']) expect(needsBridgeReload(version, '1.2')).toBe(false);
});
