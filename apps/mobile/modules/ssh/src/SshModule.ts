import { NativeModule, requireNativeModule } from "expo";

export type KeyInfo = { publicKey: string; fingerprint: string };

export type ConnectOptions = {
	host: string;
	/** Tried when the host name cannot be resolved, for example the host's Tailscale IP. */
	fallbackHost: string | null;
	port: number;
	username: string;
	keyAlias: string;
	/** null on first contact: the module reports the host identity instead of trusting it. */
	expectedFingerprint: string | null;
};

export type FailureCode =
	| "KEY_MISSING"
	| "KEY_INVALIDATED"
	| "UNLOCK_REQUIRED"
	| "HOST_KEY_UNKNOWN"
	| "HOST_KEY_CHANGED"
	| "HOST_NOT_FOUND"
	| "UNREACHABLE"
	| "AUTH_FAILED"
	| "TIMEOUT"
	| "NOT_CONNECTED"
	| "NOT_FOUND"
	| "PERMISSION_DENIED"
	| "TOO_LARGE"
	| "SOURCE_UNREADABLE"
	| "SSH_ERROR";

export type Failure = {
	ok: false;
	code: FailureCode;
	message: string;
	/** The host identity seen, for HOST_KEY_UNKNOWN and HOST_KEY_CHANGED. */
	fingerprint?: string;
	expected?: string | null;
	/** Technical detail for AUTH_FAILED. */
	detail?: string;
};

export type ConnectResult = { ok: true; connectionId: string; fingerprint: string; address: string } | Failure;
export type DirEntry = { name: string; isFile: boolean; size: number; modifiedAt: number };
export type ListResult = { ok: true; entries: DirEntry[] } | Failure;
export type ReadResult = { ok: true; content: string } | Failure;
export type ForwardResult = { ok: true; forwardId: string; localPort: number } | Failure;
export type ExecResult = { ok: true; stdout: string; stderr: string; exitStatus: number | null } | Failure;

export type TerminalOutputEvent = { terminalId: string; data: string };
export type TerminalExitEvent = { terminalId: string; exitStatus: number | null; reason: string };
export type SshEvents = {
	onTerminalOutput: (event: TerminalOutputEvent) => void;
	onTerminalExit: (event: TerminalExitEvent) => void;
};

declare class SshModule extends NativeModule<SshEvents> {
	openTerminal(connectionId: string, command: string[], cols: number, rows: number, term?: string): Promise<{ ok: true; terminalId: string } | Failure>;
	writeTerminal(terminalId: string, base64Data: string): Promise<{ ok: true } | Failure>;
	resizeTerminal(terminalId: string, cols: number, rows: number): Promise<{ ok: true } | Failure>;
	closeTerminal(terminalId: string): Promise<void>;
	ensureKey(alias: string, requireUnlock: boolean, comment: string): Promise<KeyInfo>;
	deleteKey(alias: string): Promise<void>;
	unlock(title: string): Promise<boolean>;
	connect(options: ConnectOptions): Promise<ConnectResult>;
	exec(connectionId: string, command: string): Promise<ExecResult>;
	disconnect(connectionId: string): Promise<void>;
	isConnected(connectionId: string): boolean;
	/** Whether an SSH server answers at host:port, reading only its greeting; never asks for an unlock. */
	probe(host: string, port: number, timeoutMs: number): Promise<boolean>;
	/** SFTP realpath("."); Windows drive paths are returned in native backslash form. */
	homeDirectory(connectionId: string): Promise<{ ok: true; path: string } | Failure>;
	/** Paths are relative to the user's home on the host, on Linux and Windows alike. */
	listDir(connectionId: string, path: string): Promise<ListResult>;
	readFile(connectionId: string, path: string, maxBytes: number): Promise<ReadResult>;
	/** All-or-nothing upload from a content:// or file:// URI; remoteDir is relative to home. Never overwrites an existing name. */
	uploadFile(connectionId: string, sourceUri: string, remoteDir: string, remoteName: string, maxBytes: number): Promise<{ ok: true; size: number } | Failure>;
	/** Removes one regular file, relative to home. */
	removeFile(connectionId: string, path: string): Promise<{ ok: true } | Failure>;
	/** Phone binds 127.0.0.1; the only remote destinations are 127.0.0.1 (default) and ::1. */
	forwardLocal(connectionId: string, remotePort: number, remoteHost?: "127.0.0.1" | "::1"): Promise<ForwardResult>;
	closeForward(forwardId: string): Promise<void>;
}

export default requireNativeModule<SshModule>("Ssh");
