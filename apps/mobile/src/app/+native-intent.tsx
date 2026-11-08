import { allowedSystemPath } from "../core/link-policy";

export function redirectSystemPath({ path, initial: _initial }: { path: string; initial: boolean }): string {
	return allowedSystemPath(path);
}
