import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createToken(): string {
	return randomBytes(32).toString("hex");
}

/** Constant-time comparison; hashing first hides the expected token's length. */
export function tokensMatch(given: string, expected: string): boolean {
	const digest = (value: string) => createHash("sha256").update(value).digest();
	return given.length > 0 && timingSafeEqual(digest(given), digest(expected));
}
