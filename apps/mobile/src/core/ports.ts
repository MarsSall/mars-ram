// Ports the app core needs. Adapters implement them; the core never imports
// React Native, Expo, or the native SSH module.

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

export type HostTarget = {
	host: string;
	/** Tried when the host name cannot be resolved, for example the host's Tailscale IP. */
	fallbackHost: string | null;
	port: number;
	username: string;
	keyAlias: string;
	/** null on first contact: the identity is reported instead of trusted. */
	expectedFingerprint: string | null;
};

export type TerminalExit = { exitStatus: number | null; reason: string };
export type TerminalListener = { onOutput(bytes: Uint8Array): void; onExit(exit: TerminalExit): void };

/** Interactive Herdr PTY on an already authenticated connection. Bytes are never logged. */
export interface TerminalChannel {
	open(connectionId: string, command: string[], cols: number, rows: number, term?: string): Promise<{ ok: true; terminalId: string } | Failure>;
	write(terminalId: string, bytes: Uint8Array): Promise<{ ok: true } | Failure>;
	resize(terminalId: string, cols: number, rows: number): Promise<{ ok: true } | Failure>;
	close(terminalId: string): Promise<void>;
	/** Subscribe immediately after open; returns an unsubscribe function. */
	subscribe(terminalId: string, listener: TerminalListener): () => void;
}

export type DirEntry = { name: string; isFile: boolean; size: number; modifiedAt: number };

/** An SSH connection to a host: commands, files, and tunnels (architecture: HostConnection). */
export interface HostConnection {
	connect(target: HostTarget): Promise<{ ok: true; connectionId: string; fingerprint: string; address: string } | Failure>;
	exec(connectionId: string, command: string): Promise<{ ok: true; stdout: string; stderr: string; exitStatus: number | null } | Failure>;
	disconnect(connectionId: string): Promise<void>;
	isConnected(connectionId: string): boolean;
	/** Absolute home from SFTP realpath("."); Windows /C:/ paths become native C:\\ paths. */
	homeDirectory(connectionId: string): Promise<{ ok: true; path: string } | Failure>;
	/** Paths are relative to the user's home on the host. */
	listDir(connectionId: string, path: string): Promise<{ ok: true; entries: DirEntry[] } | Failure>;
	readFile(connectionId: string, path: string, maxBytes: number): Promise<{ ok: true; content: string } | Failure>;
	/** Upload all-or-nothing from an Android content:// or file:// URI; remoteDir is relative to the user's home. Never overwrites an existing name. */
	uploadFile(connectionId: string, sourceUri: string, remoteDir: string, remoteName: string, maxBytes: number): Promise<{ ok: true; size: number } | Failure>;
	/** Remove one regular file; path is relative to the user's home. */
	removeFile(connectionId: string, path: string): Promise<{ ok: true } | Failure>;
	/** Phone loopback only; destination is exactly host 127.0.0.1 (default) or ::1. */
	forwardLocal(connectionId: string, remotePort: number, remoteHost?: "127.0.0.1" | "::1"): Promise<{ ok: true; forwardId: string; localPort: number } | Failure>;
	closeForward(forwardId: string): Promise<void>;
}
