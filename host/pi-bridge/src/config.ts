// Names come from the protocol package, the one place that names the product.
import { homedir } from "node:os";
import { join } from "node:path";
import { REGISTRY_DIRECTORY } from "@workspace/protocol";
import { checkUploadsFolder, currentHost, uploadsFolderPath, type UploadsFolderHost } from "@workspace/protocol/uploads-folder";

export { APP_ID } from "@workspace/protocol";

/** Where running bridges publish themselves; overridable for tests. */
export function registryDir(): string {
	return process.env.PI_BRIDGE_REGISTRY_DIR ?? join(homedir(), REGISTRY_DIRECTORY);
}

/**
 * Where the app copies attachments: the private temp folder `mars-ram uploads-dir` names, checked against the
 * shared policy before every lookup and never created here. PI_BRIDGE_UPLOADS_DIR overrides it for tests.
 */
export function uploadsFolder(env: NodeJS.ProcessEnv = process.env, host: UploadsFolderHost = currentHost()): { dir: string; verify?: () => Promise<boolean> } {
	const override = env.PI_BRIDGE_UPLOADS_DIR;
	if (override !== undefined) return { dir: override };
	return { dir: uploadsFolderPath(host), verify: async () => (await checkUploadsFolder(host)).ok };
}
