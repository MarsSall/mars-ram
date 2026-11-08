// Release archive of the computer side: reproducible .tar.gz, SHA256SUMS, install.sh / install.ps1 pinned to both, and the
// npm package that carries the same archive. Builds locally; publishing is the owner's decision.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildCliCopy } from '../src/adapters/cli-installation.ts';
import { buildLinkCopy } from '../src/adapters/link-installation.ts';

const bridgeSource = resolve(import.meta.dirname, '../../pi-bridge');
const installers = ['install.sh', 'install.ps1'] as const;
const npmSource = resolve(import.meta.dirname, '../npm');
// Same flags for both archives: sorted names, fixed time, owner and modes.
const tarFlags = ['--format=gnu', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=u+rwX,go+rX,go-w'];

// The checksum embedded here is each script's only trust anchor; neither reads a downloaded SHA256SUMS.
function render(path: string, values: Record<string, string>): string {
 let text = readFileSync(path, 'utf8');
 for (const [key, value] of Object.entries(values)) text = text.replaceAll(`@MARS_RAM_${key}@`, value);
 if (text.includes('@MARS_RAM_')) throw new Error(`${path} template has an unknown placeholder.`);
 return text;
}

// npm package: package/ root, only regular files (no directory entries, as npm pack), no install scripts or
// dependencies. Its launcher checks the embedded archive against the pinned SHA-256 before running anything.
function npmPackage(staging: string, version: string, archive: Uint8Array, sha256: string, fingerprint: string): Uint8Array {
 const root = join(staging, 'npm'), pkg = join(root, 'package'), name = `mars-ram-${version}`;
 const values = { VERSION: version, SHA256: sha256, CLI_FINGERPRINT: fingerprint };
 const manifest = {
  name: 'mars-ram', version, description: 'Computer side of mars-ram: pairs your phone with this computer and installs the Pi session bridge and private-link server.',
  license: 'UNLICENSED', type: 'module', bin: { 'mars-ram': 'bin/mars-ram.mjs' }, engines: { node: '>=24' }, files: ['archive', 'bin', 'README.md'],
  repository: { type: 'git', url: 'git+https://github.com/MarsSall/mars-ram.git' }, homepage: 'https://marssall.github.io/mars-ram/install',
 };
 const files: [string, string | Uint8Array][] = [['README.md', render(join(npmSource, 'README.md'), values)], [`archive/${name}.tar.gz`, archive], ['bin/mars-ram.mjs', render(join(npmSource, 'mars-ram.mjs'), values)], ['package.json', `${JSON.stringify(manifest, null, 2)}\n`]];
 for (const [path, data] of files) { mkdirSync(join(pkg, path, '..'), { recursive: true }); writeFileSync(join(pkg, path), data); }
 chmodSync(join(pkg, 'bin/mars-ram.mjs'), 0o755);
 const tar = execFileSync('tar', [...tarFlags, '-C', root, '-cf', '-', ...files.map(([path]) => `package/${path}`)], { shell: false, maxBuffer: 1024 ** 3 });
 return gzipSync(tar, { level: 9 });
}

function gnuTar(): void {
 let version = '';
 try { version = execFileSync('tar', ['--version'], { encoding: 'utf8', shell: false }); } catch { /* reported below */ }
 if (!version.includes('GNU tar')) throw new Error('GNU tar is required to build a reproducible release archive.');
}

export function buildRelease(version: string, outDir: string): { archive: string; sha256: string; npmPackage: string } {
 if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`Invalid version "${version}"; use MAJOR.MINOR.PATCH.`);
 const name = `mars-ram-${version}`;
 const archive = resolve(outDir, `${name}.tar.gz`), sums = resolve(outDir, 'SHA256SUMS'), scripts = installers.map(file => resolve(outDir, file)), tgz = resolve(outDir, `${name}.tgz`);
 for (const path of [archive, sums, ...scripts, tgz]) if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite it.`);
 gnuTar();
 const staging = mkdtempSync(join(tmpdir(), 'mars-ram-release-'));
 try {
  const folder = join(staging, name);
  mkdirSync(folder);
  buildCliCopy(folder, version);
  buildLinkCopy(folder);
  for (const entry of ['src', 'package.json']) cpSync(join(bridgeSource, entry), join(folder, 'pi-bridge', entry), { recursive: true, dereference: true });
  writeFileSync(join(folder, 'VERSION'), `${version}\n`);
  // gzip header without timestamp.
  const tar = execFileSync('tar', [...tarFlags, '-C', staging, '-cf', '-', name], { shell: false, maxBuffer: 1024 ** 3 });
  const bytes = gzipSync(tar, { level: 9 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(outDir, { recursive: true });
  const rendered = installers.map(file => render(resolve(import.meta.dirname, file), { VERSION: version, SHA256: sha256 }));
  const npm = npmPackage(staging, version, bytes, sha256, readFileSync(join(folder, 'cli/fingerprint.sha256'), 'utf8').trim());
  // Each file is created exclusively; on a failure, remove only the ones this call created,
  // including one left half-written (only EEXIST means the file was someone else's).
  const written: string[] = [];
  const create = (path: string, data: string | Uint8Array) => {
   try { writeFileSync(path, data, { flag: 'wx' }); }
   catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') written.push(path); throw error; }
   written.push(path);
  };
  try {
   create(archive, bytes);
   create(sums, `${sha256}  ${name}.tar.gz\n`);
   scripts.forEach((path, index) => create(path, rendered[index]!));
   create(tgz, npm);
  } catch (error) { for (const path of written) rmSync(path, { force: true }); throw error; }
  return { archive, sha256, npmPackage: tgz };
 } finally { rmSync(staging, { recursive: true, force: true }); }
}

if (import.meta.main) {
 const [version, outDir] = process.argv.slice(2);
 if (version === undefined || outDir === undefined || process.argv.length !== 4) {
  process.stderr.write('Usage: node host/cli/scripts/build-release.ts <MAJOR.MINOR.PATCH> <outDir>\n');
  process.exit(2);
 }
 try {
  const { archive, sha256, npmPackage } = buildRelease(version, outDir);
  process.stdout.write(`${archive}\n${sha256}\n${npmPackage}\n`);
 } catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
 }
}
