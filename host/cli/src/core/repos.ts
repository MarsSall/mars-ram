// Filesystem policy: injected path operations keep Windows semantics out of the core.
export type RepoFiles = {
 realpath(path: string): Promise<string>;
 kind(path: string): Promise<'dir' | 'file' | 'link' | null>;
 list(path: string): Promise<string[]>;
 join(a: string, b: string): string;
 absolute(path: string): boolean;
 key(path: string): string;
 name(path: string): string;
 within(root: string, path: string): boolean;
};
export type Repo = { path: string; name: string; root: string };
export const safeAbsolute = (p: string, files: RepoFiles) => p.length <= 4096 && files.absolute(p) && !/[\x00-\x1f\x7f-\x9f]/.test(p) && !p.split(/[\\/]/).includes('..');
export async function scanRepos(roots: string[], files: RepoFiles): Promise<{ repos: Repo[]; truncated: boolean }> {
 const repos: Repo[] = []; const seenDepth = new Map<string, number>(); const repoKeys = new Set<string>(); let visited = 0; let truncated = false;
 const visit = async (path: string, root: string, depth: number): Promise<void> => {
  if (repos.length >= 500 || ++visited > 20000) { truncated = true; return; }
  if (await files.kind(path) !== 'dir') return;
  const real = await files.realpath(path);
  if (!safeAbsolute(real, files) || !files.within(root, real)) return;
  const key = files.key(real); const previous = seenDepth.get(key);
  if (previous !== undefined && previous <= depth) return;
  seenDepth.set(key, depth);
  const marker = await files.kind(files.join(real, '.git'));
  if (marker === 'file' || marker === 'dir') { if (!repoKeys.has(key)) { repoKeys.add(key); repos.push({ path: real, name: files.name(real), root }); } return; }
  if (depth >= 3) return;
  for (const name of (await files.list(real)).sort()) {
   if (!name || name.startsWith('.') || name.toLowerCase() === 'node_modules' || /[\\/\x00-\x1f\x7f-\x9f]/.test(name)) continue;
   await visit(files.join(real, name), root, depth + 1);
   if (truncated) break;
  }
 };
 for (const root of [...new Set(roots)].sort()) {
  if (!safeAbsolute(root, files)) continue;
  try { const canonical = await files.realpath(root); await visit(canonical, canonical, 0); }
  catch { /* Missing or inaccessible roots do not grant access to anything. */ }
  if (truncated) break;
 }
 repos.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
 return { repos, truncated };
}
export async function allowedRepo(path: string, roots: string[], files: RepoFiles): Promise<Repo | null> {
 if (!safeAbsolute(path, files)) return null;
 try {
  const real = await files.realpath(path);
  // Only canonical scan paths are accepted, not aliases through symlinks outside roots.
  if (files.key(real) !== files.key(path)) return null;
  return (await scanRepos(roots, files)).repos.find(r => files.key(r.path) === files.key(real)) ?? null;
 } catch { return null; }
}
