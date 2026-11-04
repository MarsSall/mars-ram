import { describe, expect, it } from "vitest";
import { Installation, selectHomes } from "../../src/core/installation.ts";
import type { InstallPorts, InstallRecord } from "../../src/core/ports.ts";

function fake() {
	const calls: string[] = [];
	let record: InstallRecord | undefined;
	const registered = new Set<string>();
	const ports: InstallPorts = {
  installCli: async () => {},
		preflight: async () => { calls.push("preflight"); },
		recover: async () => { calls.push("recover"); },
		candidateHomes: async () => ["plain", "gentle"],
		readRecord: async () => record,
		writeRecord: async (value) => { record = structuredClone(value); },
		buildCopy: async () => { calls.push("build"); return { copy: "/copy", version: "1" }; },
		isRegistered: async (home) => registered.has(home),
		register: async (home) => { calls.push(`install ${home}`); registered.add(home); },
		remove: async (home) => { calls.push(`remove ${home}`); registered.delete(home); },
		deleteInstallation: async () => { calls.push("delete"); record = undefined; },
		clock: () => "2026-10-23T00:00:00.000Z",
	};
	return { ports, calls, registered, record: () => record };
}

describe("installation", () => {
	it("selects all homes or excludes numbered homes; rejects invalid answers", () => {
		expect(selectHomes(["a", "b"], "")).toEqual(["a", "b"]);
		expect(selectHomes(["a", "b"], "1")).toEqual(["b"]);
		expect(() => selectHomes(["a"], "2")).toThrow();
		expect(() => selectHomes(["a"], "wat")).toThrow();
	});
	it("detects homes, cancellation changes nothing, and preflights before prompting", async () => {
		const f = fake();
		const installation = new Installation(f.ports);
		expect(await installation.homes()).toEqual(["plain", "gentle"]);
		await installation.install(["plain"], false);
		expect(f.calls).toEqual(["preflight"]);
		expect(f.record()).toBeUndefined();
	});
	it("updates without registering twice and adds newly selected homes", async () => {
		const f = fake();
		const installation = new Installation(f.ports);
		await installation.install(["plain"], true);
		await installation.install(["plain", "gentle"], true);
		expect(f.calls.filter((c) => c.startsWith("install"))).toEqual(["install plain", "install gentle"]);
		expect(f.record()?.homes).toEqual(["plain", "gentle"]);
		expect(f.calls.filter((c) => c === "build")).toHaveLength(2);
	});
	it("uninstalls only recorded homes and leaves unrelated registrations alone", async () => {
		const f = fake();
		f.registered.add("unrelated");
		const installation = new Installation(f.ports);
		await installation.install(["plain"], true);
		await installation.uninstall(true);
		expect(f.registered).toEqual(new Set(["unrelated"]));
		expect(f.record()).toBeUndefined();
	});
	it("retains failed homes and the copy when removal partially fails", async () => {
		const f = fake();
		const installation = new Installation(f.ports);
		await installation.install(["plain", "gentle"], true);
		f.ports.remove = async (home) => { if (home === "plain") throw new Error("denied"); };
		expect(await installation.uninstall(true)).toEqual(["plain: denied"]);
		expect(f.record()?.homes).toEqual(["plain"]);
		expect(f.calls).not.toContain("delete");
	});
	it("preflight failures (missing Pi or elevation) never build or register", async () => {
		for (const message of ["pi missing", "elevated"]) {
			const f = fake();
			f.ports.preflight = async () => { throw new Error(message); };
			const installation = new Installation(f.ports);
			await expect(installation.install(["plain"], true)).rejects.toThrow(message);
			await expect(installation.uninstall(true)).rejects.toThrow(message);
			expect(f.calls).toEqual([]);
		}
	});
	it("keeps earlier registrations recoverable when a later install fails", async () => {
		const f = fake();
		const register = f.ports.register;
		f.ports.register = async (home, copy) => {
			if (home === "gentle") throw new Error("failed");
			await register(home, copy);
		};
		await expect(new Installation(f.ports).install(["plain", "gentle"], true)).rejects.toThrow("failed");
		expect(f.record()?.homes).toEqual(["plain"]);
		expect(f.calls).not.toContain("delete");
	});
	it("F2 never adopts or removes a pre-existing unrecorded registration", async () => {
		const f = fake();
		f.registered.add("plain");
		const installation = new Installation(f.ports);
		expect(await installation.install(["plain"], true)).toEqual(["plain"]);
		expect(f.record()?.homes).toEqual([]);
		await installation.uninstall(true);
		expect(f.registered.has("plain")).toBe(true);
		expect(f.calls).not.toContain("remove plain");
	});
	it("F3 writes pending intent before Pi and recovers an interrupted registration on uninstall", async () => {
		const f = fake();
		f.ports.register = async (home) => {
			expect(f.record()?.pending).toContain(home);
			f.registered.add(home);
			throw Error("interrupted after Pi wrote settings");
		};
		const installation = new Installation(f.ports);
		await expect(installation.install(["plain"], true)).rejects.toThrow("interrupted");
		expect(f.record()?.pending).toEqual(["plain"]);
		await installation.uninstall(true);
		expect(f.registered.size).toBe(0);
		expect(f.record()).toBeUndefined();
	});
	it("F3 drops pending homes without invoking Pi when registration never happened", async () => {
		const f = fake();
		f.ports.register = async () => { throw Error("before Pi"); };
		const installation = new Installation(f.ports);
		await expect(installation.install(["plain"], true)).rejects.toThrow("before Pi");
		expect(f.record()?.pending).toEqual(["plain"]);
		await installation.uninstall(true);
		expect(f.calls).not.toContain("remove plain");
		expect(f.record()).toBeUndefined();
	});
	it("F3 retry completes a recorded pending registration without reinstalling it", async () => {
		const f = fake();
		f.ports.register = async (home) => { f.registered.add(home); throw Error("interrupted"); };
		const installation = new Installation(f.ports);
		await expect(installation.install(["plain"], true)).rejects.toThrow("interrupted");
		f.ports.register = async () => { throw Error("must not register twice"); };
		expect(await installation.install(["plain"], true)).toEqual([]);
		expect(f.record()?.homes).toEqual(["plain"]);
		expect(f.record()?.pending).toEqual([]);
	});
	it("F3 removes installer leftovers even without a record, after preflight and recovery", async () => {
		const f = fake();
		expect(await new Installation(f.ports).uninstall(true)).toEqual([]);
		expect(f.calls).toEqual(["preflight", "recover", "delete"]);
	});
	it("cancelling uninstall preserves everything", async () => {
		const f = fake();
		const installation = new Installation(f.ports);
		await installation.install(["plain"], true);
		const before = [...f.calls];
		await installation.uninstall(false);
		expect(f.calls).toEqual(before);
	});
});
