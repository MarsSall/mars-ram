import { it, expect } from 'vitest';
import { posix } from 'node:path';
import { linkRuntimeFiles, linkSource } from '../../src/adapters/link-installation.ts';
it('ships a dependency-free link server with canonical notice contracts inside the installation', () => {
 const files = linkRuntimeFiles(linkSource);
 expect(files.has('src/wire/session-notice.ts')).toBe(true);
 expect(files.has('src/wire/notice-bridge.ts')).toBe(true);
 expect(files.has('src/wire/private-network.ts')).toBe(true);
 for (const [path, source] of files) {
  if (!path.endsWith('.ts')) continue;
  for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
   const target = match[1]!;
   if (target.startsWith('node:')) continue;
   expect(target.startsWith('.'), `${path}: external dependency ${target}`).toBe(true);
   expect(files.has(posix.normalize(posix.join(posix.dirname(path), target))), `${path}: missing ${target}`).toBe(true);
  }
 }
});
