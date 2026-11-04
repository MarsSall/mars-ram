import { createRepoConfig, createRepoFiles, installedProgram, localRootEdit } from './adapters/repos.ts';
import { recordedHerdr, runProcess } from './adapters/herdr-switcher.ts';
import { runLaunch, shortcutFailure } from './core/launch.ts';
import { scanRepos } from './core/repos.ts';
export async function shortcutsCommand(command: 'repos' | 'launch', args: string[]): Promise<number> {
 let result;
 try {
  const files = createRepoFiles(); const config = createRepoConfig(undefined, files);
  if (command === 'launch') {
   result = await runLaunch(args, { files, roots: await config.roots(), run: runProcess, herdr: recordedHerdr(), installed: installedProgram });
  } else {
   const flags = args.filter(a => a !== '--json');
   if (args.filter(a => a === '--json').length > 1 || !(flags.length === 0 || (flags.length === 2 && ['--add-root', '--remove-root'].includes(flags[0]!)))) result = shortcutFailure('BAD_ARGUMENT');
   else if (flags.length && !localRootEdit(process.env, !!process.stdin.isTTY && !!process.stdout.isTTY)) result = shortcutFailure('LOCAL_ONLY');
   else {
    const roots = flags.length ? await config.edit(flags[0] === '--add-root' ? 'add' : 'remove', flags[1]!) : await config.roots();
    result = { version: 1 as const, ok: true as const, roots, ...await scanRepos(roots, files) };
   }
  }
 } catch { result = shortcutFailure('CONFIG_FAILED'); }
 // JSON is also the default, matching herdr/project; --json explicitly selects this contract.
 await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(result) + '\n', e => e ? reject(e) : resolve()));
 return result.ok ? 0 : 1;
}
