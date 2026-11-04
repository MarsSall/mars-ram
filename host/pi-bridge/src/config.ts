// Names come from the protocol package, the one place that names the product.
import { homedir } from "node:os";
import { join } from "node:path";
import { REGISTRY_DIRECTORY, UPLOADS_DIRECTORY } from "@workspace/protocol";

export { APP_ID } from "@workspace/protocol";

/** Where running bridges publish themselves; overridable for tests. */
export function registryDir(): string {
	return process.env.PI_BRIDGE_REGISTRY_DIR ?? join(homedir(), REGISTRY_DIRECTORY);
}

/** Where the app copies attachments; overridable for tests. */
export function uploadsDir(): string {
	return process.env.PI_BRIDGE_UPLOADS_DIR ?? join(homedir(), UPLOADS_DIRECTORY);
}
