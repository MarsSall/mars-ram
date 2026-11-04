import { randomInt } from 'node:crypto';
import { createProjectFiles } from './adapters/project.ts';
import { recordedHerdr, runProcess } from './adapters/herdr-switcher.ts';
import { projectFailure, runProject, type ProjectDeps, type ProjectResult } from './core/project.ts';

type Output = { write(chunk: string, done: (error?: Error | null) => void): unknown };
/** One versioned JSON line, like `servers`: the whole read has a 5 s deadline, then up to
 * outputMs for the SSH pipe to accept the line; a reader that never drains it gets exit 1. */
export async function projectCommand(args: string[], out: Output = process.stdout, deps?: ProjectDeps, outputMs = 5000): Promise<number> {
 const controller = new AbortController();
 let deadline: ReturnType<typeof setTimeout> | undefined;
 const ports = deps ?? { run: runProcess, herdr: recordedHerdr(), files: createProjectFiles(), now: Date.now, random: () => randomInt(0, 1 << 30) / (1 << 30), platform: process.platform };
 let result: ProjectResult;
 try {
  result = await Promise.race([
   runProject(args, ports, controller.signal),
   new Promise<ProjectResult>(resolve => { deadline = setTimeout(() => { controller.abort(); resolve(projectFailure('PROJECT_FAILED')); }, 5000); }),
  ]);
 } finally { clearTimeout(deadline); }
 let outputTimer: ReturnType<typeof setTimeout> | undefined;
 const accepted = await Promise.race([
  new Promise<boolean>((resolve, reject) => { out.write(`${JSON.stringify(result)}\n`, error => error ? reject(error) : resolve(true)); }),
  new Promise<boolean>(resolve => { outputTimer = setTimeout(() => resolve(false), outputMs); }),
 ]).finally(() => clearTimeout(outputTimer));
 return !accepted || 'ok' in result ? 1 : 0;
}
