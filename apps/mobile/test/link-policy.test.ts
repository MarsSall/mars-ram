import { describe, expect, it } from "vitest";
import { allowedSystemPath } from "../src/core/link-policy";
import { redirectSystemPath } from "../src/app/+native-intent";

const payload = `Ab-c_D${"aB09_-".repeat(200)}`;

describe("system link allowlist", () => {
	it.each(["mars-ram://pair", "mars-ram-preview://pair", "pair", "/pair"])(
		"keeps the pairing payload byte for byte from %s",
		(route) => {
			expect(allowedSystemPath(`${route}?p=${payload}`)).toBe(`/pair?p=${payload}`);
		},
	);

	it("preserves percent escapes and plus signs without decoding or re-encoding p", () => {
		expect(allowedSystemPath("/pair?p=a%2fb%5FC+%2B%3D")).toBe("/pair?p=a%2fb%5FC+%2B%3D");
	});

	it.each([
		`/pair?standalone=1&p=${payload}&focusWorkspace=w1&focusTab=w1:t1`,
		"/pair?p=x&", "/pair?%70=x", "mars-ram:///pair?p=x", "mars-ram-preview:///pair?p=x", "/pair?p=x&p",
	])("refuses anything but exactly one literal p parameter: %s", (link) => {
		expect(allowedSystemPath(link)).toBe("/");
	});

	it.each([
		"pair?p=x&p=y", "/pair?p=x&%70=y", "pair", "pair?other=x", "pair?p=", "pair?p",
		"session/terminal/abc?standalone=1&focusWorkspace=w1&focusTab=w1:t1",
		"computer/x", "add-computer", "add-computer/manual", "add-computer/scan", "/add-computer/scan", "mars-ram://add-computer/scan", "shortcut", "dev", "session/x", "(tabs)/files",
		"/", "", "mars-ram://", "mars-ram-preview:///",
		"https://evil.example/pair?p=x", "javascript:alert(1)", "other://pair?p=x",
		"pair%2F..?p=x", "pair/?p=x", "PAIR?p=x", "pair/extra?p=x",
		"mars-ram://evil/pair?p=x", "//pair?p=x", "/pair/../pair?p=x",
		"/pair?p=%", "/pair?p=%GG", "/pair?%=x&p=y", "/pair?p=x#fragment",
		" /pair?p=x", "/pair?p=x\n",
	])("sends rejected or root input %j to Inicio", (path) => {
		expect(allowedSystemPath(path)).toBe("/");
	});

	it.each([true, false])("filters system links with initial=%s", (initial) => {
		expect(redirectSystemPath({ path: `mars-ram-preview://pair?p=${payload}`, initial }))
			.toBe(`/pair?p=${payload}`);
		expect(redirectSystemPath({ path: "mars-ram://session/terminal/abc?standalone=1", initial }))
			.toBe("/");
	});
});
