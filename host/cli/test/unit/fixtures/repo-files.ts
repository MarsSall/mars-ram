import type { RepoFiles } from '../../../src/core/repos.ts';
export function fakeFiles(entries: Record<string, 'dir' | 'file' | 'link'>, real: Record<string, string> = {}): RepoFiles {
 return {
  realpath: async p => { if (!(p in entries)) throw Error(); return real[p] ?? p; },
  kind: async p => entries[p] ?? null,
  list: async p => Object.keys(entries).filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(k => k.slice(p.length + 1)),
  join: (a, b) => a + '/' + b, absolute: p => p.startsWith('/'), key: p => p,
  name: p => p.split('/').at(-1)!, within: (root, p) => p === root || p.startsWith(root + '/'),
 };
}
