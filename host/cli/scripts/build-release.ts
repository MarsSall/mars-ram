// Release archive of the computer side: reproducible .tar.gz, SHA256SUMS, and install.sh / install.ps1 pinned to both. Builds locally; publishing is the owner's decision.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildCliCopy } from '../src/adapters/cli-installation.ts';
import { buildLinkCopy } from '../src/adapters/link-installation.ts';

const bridgeSource = resolve(import.meta.dirname, '../../pi-bridge');
const installers = ['install.sh', 'install.ps1'] as const;

// The checksum embedded here is each script's only trust anchor; neither reads a downloaded SHA256SUMS.
function renderInstallScript(name: string, version: string, sha256: string): string {
 const script = readFileSync(resolve(import.meta.dirname, name), 'utf8').replaceAll('@MARS_RAM_VERSION@', version).replaceAll('@MARS_RAM_SHA256@', sha256);
 if (script.includes('@MARS_RAM_')) throw new Error(`${name} template has an unknown placeholder.`);
 return script;
}

function gnuTar(): void {
 let version = '';
 try { version = execFileSync('tar', ['--version'], { encoding: 'utf8', shell: false }); } catch { /* reported below */ }
 if (!version.includes('GNU tar')) throw new Error('GNU tar is required to build a reproducible release archive.');
}

export function buildRelease(version: string, outDir: string): { archive: string; sha256: string } {
 if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`Invalid version "${version}"; use MAJOR.MINOR.PATCH.`);
 const name = `mars-ram-${version}`;
 const archive = resolve(outDir, `${name}.tar.gz`), sums = resolve(outDir, 'SHA256SUMS'), scripts = installers.map(file => resolve(outDir, file));
 for (const path of [archive, sums, ...scripts]) if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite it.`);
 gnuTar();
 const staging = mkdtempSync(join(tmpdir(), 'mars-ram-release-'));
 try {
  const folder = join(staging, name);
  mkdirSync(folder);
  buildCliCopy(folder);
  buildLinkCopy(folder);
  for (const entry of ['src', 'package.json']) cpSync(join(bridgeSource, entry), join(folder, 'pi-bridge', entry), { recursive: true, dereference: true });
  writeFileSync(join(folder, 'VERSION'), `${version}\n`);
  // Sorted names, fixed time, owner and modes; gzip header without timestamp.
  const tar = execFileSync('tar', ['--format=gnu', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=u+rwX,go+rX,go-w', '-C', staging, '-cf', '-', name], { shell: false, maxBuffer: 1024 ** 3 });
  const bytes = gzipSync(tar, { level: 9 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(outDir, { recursive: true });
  const rendered = installers.map(file => renderInstallScript(file, version, sha256));
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
  } catch (error) { for (const path of written) rmSync(path, { force: true }); throw error; }
  return { archive, sha256 };
 } finally { rmSync(staging, { recursive: true, force: true }); }
}

if (import.meta.main) {
 const [version, outDir] = process.argv.slice(2);
 if (version === undefined || outDir === undefined || process.argv.length !== 4) {
  process.stderr.write('Usage: node host/cli/scripts/build-release.ts <MAJOR.MINOR.PATCH> <outDir>\n');
  process.exit(2);
 }
 try {
  const { archive, sha256 } = buildRelease(version, outDir);
  process.stdout.write(`${archive}\n${sha256}\n`);
 } catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
 }
}
