import { recordedHerdr, runProcess } from './adapters/herdr-switcher.ts';
import { runHerdr } from './core/herdr-switcher.ts';

type Output = { write(chunk: string, done: (error?: Error | null) => void): unknown };

/** Exactly one versioned JSON line on stdout, including sanitized errors.
 * Resolves only after stdout accepted the line: main exits right after, and a
 * pipe (SSH) may still hold a large list when process.exit runs. */
export async function herdrCommand(args: string[], out: Output = process.stdout): Promise<number> {
 const result = await runHerdr(args, { run: runProcess, binary: recordedHerdr() });
 await new Promise<void>((resolve, reject) => { out.write(`${JSON.stringify(result)}\n`, error => error ? reject(error) : resolve()); });
 return 'ok' in result && !result.ok ? 1 : 0;
}
