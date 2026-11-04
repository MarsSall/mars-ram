import { describe, expect, it } from "vitest";
import { parseArguments } from "../../src/arguments.ts";

describe("parseArguments", () => {
	it.each([
		[["pair"], { ok: true, command: "pair", sshPort: 22 }],
		[["install"], { ok: true, command: "install" }],
		[["uninstall"], { ok: true, command: "uninstall" }],
		[["pair", "--ssh-port", "2222"], { ok: true, command: "pair", sshPort: 2222 }],
	])("accepts %j", (args, expected) => {
		expect(parseArguments(args)).toEqual(expected);
	});

	it.each([
		[[]],
		[["unpair"]],
		[["install", "--yes"]],
		[["uninstall", "extra"]],
		[["pair", "extra"]],
		[["pair", "--unknown"]],
		[["pair", "--ssh-port"]],
		[["pair", "--ssh-port", "0"]],
		[["pair", "--ssh-port", "22x"]],
		[["pair", "--ssh-port", "22", "--ssh-port", "2222"]],
	])("refuses %j", (args) => {
		expect(parseArguments(args)).toEqual({ ok: false });
	});
});
