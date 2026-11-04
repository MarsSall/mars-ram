/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FakeSsh, FakeTerminalChannel, failure } from "./fakes";
import { sshModuleHostConnection, sshModuleTerminalChannel } from "../src/adapters/ssh-module-host-connection";

const native = vi.hoisted(() => ({
 forwardLocal: vi.fn(async () => ({ ok: true, forwardId: "f", localPort: 51000 })),
	openTerminal: vi.fn(async () => ({ ok: true, terminalId: "term" })),
	writeTerminal: vi.fn(async () => ({ ok: true })),
	resizeTerminal: vi.fn(async () => ({ ok: true })),
	closeTerminal: vi.fn(async () => undefined),
	listeners: new Map<string, (event: any) => void>(),
	addListener: vi.fn((name: string, listener: (event: any) => void) => {
		native.listeners.set(name, listener);
		return { remove: () => native.listeners.delete(name) };
	}),
}));
vi.mock("../modules/ssh/src/SshModule", () => ({ default: native }));

describe("terminal channel", () => {
 it("keeps bridge forwards on IPv4 loopback and passes explicit IPv6 for the server viewer", async () => {
  await sshModuleHostConnection.forwardLocal("conn", 40000);
  expect(native.forwardLocal).toHaveBeenLastCalledWith("conn", 40000, "127.0.0.1");
  await sshModuleHostConnection.forwardLocal("conn", 3000, "::1");
  expect(native.forwardLocal).toHaveBeenLastCalledWith("conn", 3000, "::1");
 });
	it("adapts arbitrary binary bytes and scopes/removes native subscriptions", async () => {
		const terminal = sshModuleTerminalChannel;
		expect(await terminal.open("conn", ["herdr"], 80, 24)).toEqual({ ok: true, terminalId: "term" });
		expect(native.openTerminal).toHaveBeenCalledWith("conn", ["herdr"], 80, 24, "xterm-256color");
		const bytes = new Uint8Array([0, 27, 127, 128, 255]);
		await terminal.write("term", bytes);
		expect(native.writeTerminal).toHaveBeenCalledWith("term", "ABt/gP8=");
		const onOutput = vi.fn();
		const onExit = vi.fn();
		const unsubscribe = terminal.subscribe("term", { onOutput, onExit });
		native.listeners.get("onTerminalOutput")!({ terminalId: "other", data: "AA==" });
		expect(onOutput).not.toHaveBeenCalled();
		native.listeners.get("onTerminalOutput")!({ terminalId: "term", data: "ABt/gP8=" });
		expect(onOutput).toHaveBeenCalledWith(bytes);
		native.listeners.get("onTerminalExit")!({ terminalId: "term", exitStatus: null, reason: "connection_closed" });
		expect(onExit).toHaveBeenCalledWith({ exitStatus: null, reason: "connection_closed" });
		await terminal.resize("term", 120, 40);
		expect(native.resizeTerminal).toHaveBeenCalledWith("term", 120, 40);
		await terminal.close("term");
		expect(native.closeTerminal).toHaveBeenCalledWith("term");
		unsubscribe();
		expect(native.listeners.size).toBe(0);
	});

	it("converts empty data and every base64 padding case, and caps writes before encoding", async () => {
		const onOutput = vi.fn();
		await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
		const unsubscribe = sshModuleTerminalChannel.subscribe("term", { onOutput, onExit: vi.fn() });
		const source = new Uint8Array([0, 255, 27, 128, 127]);
		const encoded = ["", "AA==", "AP8=", "AP8b", "AP8bgA==", "AP8bgH8="];
		for (let length = 0; length <= source.length; length++) {
			const bytes = source.slice(0, length);
			await sshModuleTerminalChannel.write("term", bytes);
			expect(native.writeTerminal).toHaveBeenLastCalledWith("term", encoded[length]);
			native.listeners.get("onTerminalOutput")!({ terminalId: "term", data: encoded[length] });
			expect(onOutput).toHaveBeenLastCalledWith(bytes);
		}
		const calls = native.writeTerminal.mock.calls.length;
		expect(await sshModuleTerminalChannel.write("term", new Uint8Array(65537))).toMatchObject({ ok: false, code: "TOO_LARGE" });
		expect(native.writeTerminal.mock.calls.length).toBe(calls);
		unsubscribe();
	});

	it("retains initial output and fast exit emitted before open resolves", async () => {
		native.openTerminal.mockImplementationOnce(async () => {
			native.listeners.get("onTerminalOutput")?.({ terminalId: "fast", data: "/w==" });
			native.listeners.get("onTerminalExit")?.({ terminalId: "fast", exitStatus: 0, reason: "exited" });
			return { ok: true, terminalId: "fast" };
		});
		await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
		const onOutput = vi.fn();
		const onExit = vi.fn();
		const unsubscribe = sshModuleTerminalChannel.subscribe("fast", { onOutput, onExit });
		expect(onOutput).toHaveBeenCalledWith(new Uint8Array([255]));
		expect(onExit).toHaveBeenCalledWith({ exitStatus: 0, reason: "exited" });
		unsubscribe();
	});

	it("bounds pending output to 256 KiB and reports overflow once before the retained tail", async () => {
		await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
		const emit = native.listeners.get("onTerminalOutput")!;
		for (const byte of [1, 2, 3, 4]) emit({ terminalId: "term", data: Buffer.alloc(128 * 1024, byte).toString("base64") });
		const onOutput = vi.fn();
		const onExit = vi.fn();
		const unsubscribe = sshModuleTerminalChannel.subscribe("term", { onOutput, onExit });
		expect(onExit).toHaveBeenCalledExactlyOnceWith({ exitStatus: null, reason: "overflow" });
		expect(onOutput.mock.calls.reduce((sum, [bytes]) => sum + bytes.length, 0)).toBe(256 * 1024);
		expect(onOutput.mock.calls.map(([bytes]) => bytes[0])).toEqual([3, 4]);
		unsubscribe();
	});

	it("caps capture globally before the id is known and drops other terminals once known", async () => {
		native.openTerminal.mockImplementationOnce(async () => {
			for (let i = 0; i < 4; i++) native.listeners.get("onTerminalOutput")!({ terminalId: "term", data: Buffer.alloc(128 * 1024, i).toString("base64") });
			return { ok: true, terminalId: "term" };
		});
		await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
		// Unrelated traffic must neither enter the buffer nor evict this terminal's tail.
		for (let i = 0; i < 4; i++) native.listeners.get("onTerminalOutput")!({ terminalId: "other", data: Buffer.alloc(128 * 1024, 9).toString("base64") });
		const onOutput = vi.fn();
		const onExit = vi.fn();
		const unsubscribe = sshModuleTerminalChannel.subscribe("term", { onOutput, onExit });
		expect(onOutput.mock.calls.map(([bytes]) => bytes[0])).toEqual([2, 3]);
		expect(onExit).toHaveBeenCalledExactlyOnceWith({ exitStatus: null, reason: "overflow" });
		unsubscribe();
	});

	it("detaches native listeners on exit before subscription and still replays the fast exit", async () => {
		await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
		native.listeners.get("onTerminalExit")!({ terminalId: "term", exitStatus: 0, reason: "exited" });
		expect(native.listeners.size).toBe(0);
		const onExit = vi.fn();
		const unsubscribe = sshModuleTerminalChannel.subscribe("term", { onOutput: vi.fn(), onExit });
		expect(onExit).toHaveBeenCalledExactlyOnceWith({ exitStatus: 0, reason: "exited" });
		unsubscribe();
	});

	it("disposes capture on close even when a subscriber is attached", async () => {
		await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
		const unsubscribe = sshModuleTerminalChannel.subscribe("term", { onOutput: vi.fn(), onExit: vi.fn() });
		await sshModuleTerminalChannel.close("term");
		expect(native.listeners.size).toBe(0);
		unsubscribe();
	});

	it("closes an abandoned open after 10 seconds but cancels the deadline on subscription", async () => {
		vi.useFakeTimers();
		try {
			native.closeTerminal.mockClear();
			await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
			await vi.advanceTimersByTimeAsync(9999);
			expect(native.closeTerminal).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(native.closeTerminal).toHaveBeenCalledExactlyOnceWith("term");
			expect(native.listeners.size).toBe(0);
			native.closeTerminal.mockClear();
			await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
			const unsubscribe = sshModuleTerminalChannel.subscribe("term", { onOutput: vi.fn(), onExit: vi.fn() });
			await vi.advanceTimersByTimeAsync(10000);
			expect(native.closeTerminal).not.toHaveBeenCalled();
			unsubscribe();
		} finally { vi.useRealTimers(); }
	});

	it("disposes while native open is unresolved and closes when its id eventually arrives", async () => {
		vi.useFakeTimers();
		try {
			native.closeTerminal.mockClear();
			let resolve!: (result: { ok: boolean; terminalId: string }) => void;
			native.openTerminal.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
			const opening = sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
			await vi.advanceTimersByTimeAsync(10000);
			expect(native.listeners.size).toBe(0);
			expect(native.closeTerminal).not.toHaveBeenCalled();
			resolve({ ok: true, terminalId: "late" });
			await opening;
			expect(native.closeTerminal).toHaveBeenCalledExactlyOnceWith("late");
			expect(native.listeners.size).toBe(0);
		} finally { vi.useRealTimers(); }
	});

	it("filters unrelated output and exits captured before the terminal id is known", async () => {
		native.openTerminal.mockImplementationOnce(async () => {
			native.listeners.get("onTerminalOutput")!({ terminalId: "other", data: "/w==" });
			native.listeners.get("onTerminalExit")!({ terminalId: "other", exitStatus: 0, reason: "exited" });
			native.listeners.get("onTerminalOutput")!({ terminalId: "term", data: "AQ==" });
			return { ok: true, terminalId: "term" };
		});
		await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
		const onOutput = vi.fn();
		const onExit = vi.fn();
		const unsubscribe = sshModuleTerminalChannel.subscribe("term", { onOutput, onExit });
		expect(onOutput).toHaveBeenCalledExactlyOnceWith(new Uint8Array([1]));
		expect(onExit).not.toHaveBeenCalled();
		// The other terminal's exit must not detach this terminal's capture.
		native.listeners.get("onTerminalOutput")!({ terminalId: "term", data: "Ag==" });
		expect(onOutput).toHaveBeenLastCalledWith(new Uint8Array([2]));
		unsubscribe();
	});

	it("bounds empty events as well as bytes and disposes a subscribed exit immediately", async () => {
		await sshModuleTerminalChannel.open("conn", ["herdr"], 80, 24);
		for (let i = 0; i < 2048; i++) native.listeners.get("onTerminalOutput")!({ terminalId: "term", data: "" });
		const onOutput = vi.fn();
		const onExit = vi.fn();
		const unsubscribe = sshModuleTerminalChannel.subscribe("term", { onOutput, onExit });
		expect(onOutput).toHaveBeenCalledTimes(1024);
		expect(onExit).toHaveBeenCalledExactlyOnceWith({ exitStatus: null, reason: "overflow" });
		native.listeners.get("onTerminalExit")!({ terminalId: "term", exitStatus: 0, reason: "exited" });
		expect(native.listeners.size).toBe(0);
		expect(onExit).toHaveBeenLastCalledWith({ exitStatus: 0, reason: "exited" });
		unsubscribe();
	});

	it("native session-name allow-list rejects option-like names and accepts 1–64 safe characters", () => {
		const source = readFileSync(new URL("../modules/ssh/android/src/main/java/expo/modules/ssh/SshModule.kt", import.meta.url), "utf8");
		const pattern = source.match(/Regex\("([^"]+)"\)\.matches\(command\[2\]\)/)?.[1];
		expect(pattern).toBe("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
		const name = new RegExp(pattern!);
		for (const invalid of ["-", "--help", ".work", "_work", "", "a b", "a;id", "a".repeat(65)]) expect(name.test(invalid)).toBe(false);
		for (const valid of ["a", "0", "work-1.2_3", "a".repeat(64)]) expect(name.test(valid)).toBe(true);
	});

	it("fake records writes/sizes, emits output/exit, and stops closed terminals", async () => {
		const terminal = new FakeTerminalChannel();
		const opened = await terminal.open("conn", ["herdr", "--session", "work-1"], 80, 24);
		if (!opened.ok) throw new Error("open failed");
		const id = opened.terminalId;
		const onOutput = vi.fn();
		const onExit = vi.fn();
		const unsubscribe = terminal.subscribe(id, { onOutput, onExit });
		const bytes = new Uint8Array([0, 255]);
		await terminal.write(id, bytes);
		await terminal.resize(id, 100, 30);
		expect(terminal.writes).toEqual([{ terminalId: id, bytes }]);
		expect(terminal.resizes).toEqual([{ terminalId: id, cols: 100, rows: 30 }]);
		terminal.pushOutput(id, bytes);
		expect(onOutput).toHaveBeenCalledWith(bytes);
		terminal.pushExit(id, { exitStatus: 0, reason: "exited" });
		expect(onExit).toHaveBeenCalledTimes(1);
		expect(await terminal.write(id, bytes)).toEqual(failure("NOT_CONNECTED"));
		terminal.pushOutput(id, bytes);
		expect(onOutput).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it("fake rejects command injection, invalid sizes and oversized writes", async () => {
		const terminal = new FakeTerminalChannel();
		for (const command of [["sh"], ["herdr;whoami"], ["herdr", "--session", "a b"], ["herdr", "--session", "a".repeat(65)], ["herdr", "extra"]]) {
			expect(await terminal.open("conn", command, 80, 24)).toMatchObject({ ok: false, code: "SSH_ERROR", message: "Only Herdr can be opened" });
		}
		for (const size of [0, 1001, 1.5, NaN]) expect(await terminal.open("conn", ["herdr"], size, 24)).toMatchObject({ ok: false, code: "SSH_ERROR" });
		const opened = await terminal.open("conn", ["herdr"], 1, 1000);
		if (!opened.ok) throw new Error("open failed");
		expect(await terminal.write(opened.terminalId, new Uint8Array(65536))).toEqual({ ok: true });
		expect(await terminal.write(opened.terminalId, new Uint8Array(65537))).toEqual(failure("TOO_LARGE"));
		expect(await terminal.resize(opened.terminalId, 0, 24)).toEqual(failure("SSH_ERROR"));
		const onExit = vi.fn();
		terminal.subscribe(opened.terminalId, { onOutput: vi.fn(), onExit });
		await terminal.close(opened.terminalId);
		await terminal.close(opened.terminalId);
		expect(onExit).toHaveBeenCalledTimes(1);
	});
});

describe("attachment transfer HostConnection fake", () => {
	it("records a complete upload with size and modification time, then removes it", async () => {
		const ssh = new FakeSsh();
		ssh.sourceSizes.set("content://photo", 4);
		const before = Date.now();
		expect(await ssh.uploadFile("conn", "content://photo", ".mars-ram/uploads", "photo.png", 4)).toEqual({ ok: true, size: 4 });
		const listing = await ssh.listDir("conn", ".mars-ram/uploads");
		expect(listing).toEqual({ ok: true, entries: [{ name: "photo.png", isFile: true, size: 4, modifiedAt: expect.any(Number) }] });
		if (listing.ok) expect(listing.entries[0].modifiedAt).toBeGreaterThanOrEqual(before);
		expect(await ssh.removeFile("conn", ".mars-ram/uploads/photo.png")).toEqual({ ok: true });
		expect(await ssh.listDir("conn", ".mars-ram/uploads")).toEqual({ ok: true, entries: [] });
		expect(await ssh.removeFile("conn", ".mars-ram/uploads/photo.png")).toEqual(failure("NOT_FOUND"));
	});

	it("rejects oversize and injected failures without recording any file", async () => {
		const ssh = new FakeSsh();
		ssh.sourceSizes.set("file:///cache/photo", 5);
		expect(await ssh.uploadFile("conn", "file:///cache/photo", ".mars-ram/uploads", "photo.png", 4)).toEqual(failure("TOO_LARGE"));
		ssh.refuse = failure("PERMISSION_DENIED");
		expect(await ssh.uploadFile("conn", "file:///cache/photo", ".mars-ram/uploads", "photo.png", 5)).toEqual(ssh.refuse);
		ssh.refuse = null;
		expect(await ssh.listDir("conn", ".mars-ram/uploads")).toEqual({ ok: true, entries: [] });
	});

	it("rejects unreadable sources, unsafe names, invalid limits and existing destinations", async () => {
		const ssh = new FakeSsh();
		ssh.sourceSizes.set("content://photo", 0);
		expect(await ssh.uploadFile("conn", "missing", "uploads", "photo", 5)).toEqual(failure("SOURCE_UNREADABLE"));
		for (const name of ["", ".hidden", "a/b", "a\\b", "a:b", "a.part"]) {
			expect(await ssh.uploadFile("conn", "content://photo", "uploads", name, 5)).toEqual(failure("SSH_ERROR"));
		}
		expect(await ssh.uploadFile("conn", "content://photo", "uploads", "photo", 0)).toEqual(failure("SSH_ERROR"));
		expect(await ssh.uploadFile("conn", "content://photo", "uploads", "photo", 5)).toEqual({ ok: true, size: 0 });
		expect(await ssh.uploadFile("conn", "content://photo", "uploads", "photo", 5)).toEqual(failure("SSH_ERROR"));
		ssh.refuse = failure("PERMISSION_DENIED");
		expect(await ssh.removeFile("conn", "uploads/photo")).toEqual(ssh.refuse);
		expect(await ssh.listDir("conn", "uploads")).toEqual(ssh.refuse);
		ssh.refuse = null;
		expect((await ssh.listDir("conn", "uploads"))).toMatchObject({ ok: true, entries: [{ size: 0 }] });
	});
});
