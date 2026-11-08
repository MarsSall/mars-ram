/** Only system links pass here; internal router navigation keeps its own routes. */
export function allowedSystemPath(path: string): string {
	// Match the raw link, not a URL-normalized path (which could hide traversal):
	// exactly one literal `p` parameter on the exact pair route, nothing else.
	const match = /^(?:(?:mars-ram|mars-ram-preview):\/\/|\/)?pair\?p=([A-Za-z0-9_\-.~%+]+)$/.exec(path);
	if (!match) return "/";
	const payload = match[1]!;
	try {
		// Reject malformed escapes; the raw value is forwarded unchanged.
		decodeURIComponent(payload.replace(/\+/g, " "));
	} catch {
		return "/";
	}
	return `/pair?p=${payload}`;
}
