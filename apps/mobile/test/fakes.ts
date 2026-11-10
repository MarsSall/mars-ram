// Test doubles shared by the app core tests.
import { validHerdrPath } from "../src/core/herdr-terminal";
import type { SavedHost } from "../src/core/host-catalog";
import type { DirEntry, Failure, HostConnection, HostTarget, TerminalChannel, TerminalExit, TerminalListener } from "../src/core/ports";
import type { UploadsFolder, UploadsFolderLookup, UploadsFolderResult } from "../src/core/uploads-folder";

export const savedHost = (id: string, extra: Partial<SavedHost> = {}): SavedHost => ({
	id,
	name: `Computer ${id}`,
	address: "100.64.0.1",
	sshPort: 22,
	user: "dev",
	hostKey: `SHA256:${"A".repeat(43)}`,
	addedAt: 1,
	...extra,
});

export const failure = (code: Failure["code"]): Failure => ({ ok: false, code, message: code });

export const TEMP_UPLOADS: UploadsFolder = { path: "/tmp/mars-ram-1000/uploads", sftpPath: "/tmp/mars-ram-1000/uploads", windows: false };
/** The host's uploads folder per connection; tests set the result and read the calls. */
export class FakeUploadsFolder implements UploadsFolderLookup {
	result: UploadsFolderResult = { ok: true, folder: TEMP_UPLOADS };
	calls: string[] = [];
	async folder(connectionId: string): Promise<UploadsFolderResult> {
		this.calls.push(connectionId);
		return this.result;
	}
}

/** Native rule: an absolute path is only accepted inside the explicit uploads root. */
const scoped = (path: string, root: string | undefined, file: boolean) => root === undefined ? !path.startsWith("/")
	: root.startsWith("/") && (file ? path.startsWith(`${root}/`) && !/[/\\]/.test(path.slice(root.length + 1)) && ![".", ".."].includes(path.slice(root.length + 1)) : path === root);

/** In-memory interactive terminal; tests drive remote output and exits explicitly. */
export class FakeTerminalChannel implements TerminalChannel {
	opens: { connectionId: string; command: string[]; cols: number; rows: number; term: string }[] = [];
	writes: { terminalId: string; bytes: Uint8Array }[] = [];
	resizes: { terminalId: string; cols: number; rows: number }[] = [];
	private alive = new Set<string>();
	private listeners = new Map<string, Set<TerminalListener>>();
	private next = 0;
	private validSize(cols: number, rows: number) {
		return [cols, rows].every((n) => Number.isInteger(n) && n >= 1 && n <= 1000);
	}
	async open(connectionId: string, command: string[], cols: number, rows: number, term = "xterm-256color") {
		if (!(validHerdrPath(command[0]) && (command.length === 1 || (command.length === 3 && command[1] === "--session" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(command[2]))))) {
			return { ...failure("SSH_ERROR"), message: "Only Herdr can be opened" };
		}
		if (!this.validSize(cols, rows)) return failure("SSH_ERROR");
		this.opens.push({ connectionId, command: [...command], cols, rows, term });
		const terminalId = `terminal-${++this.next}`;
		this.alive.add(terminalId);
		return { ok: true as const, terminalId };
	}
	async write(terminalId: string, bytes: Uint8Array) {
		if (bytes.length > 65536) return failure("TOO_LARGE");
		if (!this.alive.has(terminalId)) return failure("NOT_CONNECTED");
		this.writes.push({ terminalId, bytes: bytes.slice() });
		return { ok: true as const };
	}
	async resize(terminalId: string, cols: number, rows: number) {
		if (!this.validSize(cols, rows)) return failure("SSH_ERROR");
		if (!this.alive.has(terminalId)) return failure("NOT_CONNECTED");
		this.resizes.push({ terminalId, cols, rows });
		return { ok: true as const };
	}
	async close(terminalId: string) { this.pushExit(terminalId, { exitStatus: null, reason: "closed" }); }
	subscribe(terminalId: string, listener: TerminalListener) {
		const listeners = this.listeners.get(terminalId) ?? new Set<TerminalListener>();
		this.listeners.set(terminalId, listeners);
		listeners.add(listener);
		return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(terminalId); };
	}
	pushOutput(terminalId: string, bytes: Uint8Array) {
		if (this.alive.has(terminalId)) this.listeners.get(terminalId)?.forEach((listener) => listener.onOutput(bytes.slice()));
	}
	/** The real adapter's overflow marker: delivered through onExit, but the terminal stays open. */
	pushOverflow(terminalId: string) {
		if (this.alive.has(terminalId)) this.listeners.get(terminalId)?.forEach((listener) => listener.onExit({ exitStatus: null, reason: "overflow" }));
	}
	pushExit(terminalId: string, exit: TerminalExit) {
		if (this.alive.delete(terminalId)) this.listeners.get(terminalId)?.forEach((listener) => listener.onExit(exit));
	}
}

/** Connects unless told otherwise; the key needs unlocking while `locked` is true. */
export class FakeSsh implements HostConnection {
 serverForwards: { connectionId: string; remotePort: number; remoteHost: string }[] = [];
 closedForwards: string[] = [];
 async exec(_connectionId: string, _command: string): ReturnType<HostConnection["exec"]> { return failure("SSH_ERROR"); }
 async forwardLocal(connectionId: string, remotePort: number, remoteHost: "127.0.0.1" | "::1" = "127.0.0.1"): ReturnType<HostConnection["forwardLocal"]> {
  if (!["127.0.0.1", "::1"].includes(remoteHost) || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return failure("SSH_ERROR");
  this.serverForwards.push({ connectionId, remotePort, remoteHost });
  return { ok: true, forwardId: `forward-${this.serverForwards.length}`, localPort: 51000 };
 }
 async closeForward(id: string) { this.closedForwards.push(id); }
	home = "/home/dev";
 async readFile(_connectionId: string, _path: string, _maxBytes: number): Promise<{ ok: true; content: string } | Failure> { return failure("NOT_FOUND"); }
	async homeDirectory(_connectionId: string) {
		return this.refuse ?? { ok: true as const, path: this.home };
	}
	locked = false;
	refuse: Failure | null = null;
	connects: HostTarget[] = [];
	/** The target each open connection reached. */
	targets = new Map<string, HostTarget>();
	alive = new Set<string>();
	disconnected: string[] = [];
	/** Local picker/cache source sizes; absent sources are unreadable. */
	sourceSizes = new Map<string, number>();
	/** Complete remote files keyed by home-relative path. */
	uploadedFiles = new Map<string, DirEntry>();
	private next = 0;

	async uploadFile(_connectionId: string, sourceUri: string, remoteDir: string, remoteName: string, maxBytes: number, root?: string) {
		if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !scoped(remoteDir, root, false)) return failure("SSH_ERROR");
		if (!remoteName || remoteName.startsWith(".") || /[/\\\\:]/.test(remoteName) || remoteName.endsWith(".part")) return failure("SSH_ERROR");
		if (this.refuse) return this.refuse;
		const size = this.sourceSizes.get(sourceUri);
		if (size === undefined) return failure("SOURCE_UNREADABLE");
		if (size > maxBytes) return failure("TOO_LARGE");
		const path = `${remoteDir.replace(/\/$/, "")}/${remoteName}`;
		if (this.uploadedFiles.has(path)) return failure("SSH_ERROR");
		this.uploadedFiles.set(path, { name: remoteName, isFile: true, size, modifiedAt: Date.now() });
		return { ok: true as const, size };
	}

	async listDir(_connectionId: string, path: string, root?: string) {
		if (!scoped(path, root, false)) return failure("SSH_ERROR");
		if (this.refuse) return this.refuse;
		const prefix = `${path.replace(/\/$/, "")}/`;
		const entries = [...this.uploadedFiles.entries()]
			.filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
			.map(([, entry]) => ({ ...entry }));
		return { ok: true as const, entries };
	}

	async removeFile(_connectionId: string, path: string, root?: string) {
		if (!scoped(path, root, true)) return failure("SSH_ERROR");
		if (this.refuse) return this.refuse;
		const entry = this.uploadedFiles.get(path);
		if (!entry) return failure("NOT_FOUND");
		if (!entry.isFile) return failure("SSH_ERROR");
		this.uploadedFiles.delete(path);
		return { ok: true as const };
	}

	async connect(target: HostTarget) {
		this.connects.push(target);
		await Promise.resolve();
		if (this.locked) return failure("UNLOCK_REQUIRED");
		if (this.refuse) return this.refuse;
		const connectionId = `conn-${++this.next}`;
		this.alive.add(connectionId);
		this.targets.set(connectionId, target);
		return { ok: true as const, connectionId, fingerprint: target.expectedFingerprint ?? "", address: target.host };
	}
	isConnected(connectionId: string) {
		return this.alive.has(connectionId);
	}
	async disconnect(connectionId: string) {
		this.alive.delete(connectionId);
		this.disconnected.push(connectionId);
	}
}
