import { prepareUploadsFolder, type UploadsFolderHost, type UploadsFolderState } from '@workspace/protocol/uploads-folder';

type Output = { write(chunk: string, done: (error?: Error | null) => void): unknown };

/** Creates or verifies the private attachments folder and prints exactly one versioned JSON line on stdout,
 * refusals included. Resolves only after stdout accepted the line: main exits right after. */
export async function uploadsDirCommand(out: Output = process.stdout, prepare: (host?: UploadsFolderHost) => Promise<UploadsFolderState> = prepareUploadsFolder, host?: UploadsFolderHost): Promise<number> {
 const state = await prepare(host);
 const line = state.ok ? { v: 1, path: state.path }
  : { v: 1, error: state.error === 'unsafe_folder' ? 'unsafe_folder' : 'unavailable', message: state.error === 'missing' ? `Could not prepare the attachments folder ${state.path}.` : state.message };
 await new Promise<void>((resolve, reject) => { out.write(`${JSON.stringify(line)}\n`, error => error ? reject(error) : resolve()); });
 return state.ok ? 0 : 1;
}
