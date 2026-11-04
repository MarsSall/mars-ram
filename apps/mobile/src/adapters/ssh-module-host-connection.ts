// HostConnection adapter over the Kotlin SSH native module.
import Ssh from "../../modules/ssh/src/SshModule";
import type { HostConnection, TerminalChannel, TerminalListener } from "../core/ports";

// Pure byte conversion: React Native need not provide Buffer, btoa or atob.
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encode(bytes: Uint8Array): string {
	let result = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
		result += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63]
			+ (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : "=")
			+ (i + 2 < bytes.length ? alphabet[n & 63] : "=");
	}
	return result;
}
function decode(data: string): Uint8Array {
	const bytes = new Uint8Array((data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0));
	let offset = 0;
	for (let i = 0; i < data.length; i += 4) {
		const n = (alphabet.indexOf(data[i]) << 18) | (alphabet.indexOf(data[i + 1]) << 12)
			| (Math.max(0, alphabet.indexOf(data[i + 2])) << 6) | Math.max(0, alphabet.indexOf(data[i + 3]));
		for (const shift of [16, 8, 0]) if (offset < bytes.length) bytes[offset++] = (n >>> shift) & 255;
	}
	return bytes;
}

// Capture before open: Herdr can draw/exit before the native promise resolves.
const PENDING_BYTES = 256 * 1024;
const PENDING_EVENTS = 1024; // Also bound zero-byte output and unknown-terminal exit metadata.
const SUBSCRIBE_TIMEOUT_MS = 10_000;
type PendingEvent = { terminalId: string } & ({ data: string } | { exitStatus: number | null; reason: string });
const eventBytes = (event: PendingEvent) => "data" in event
	? (event.data.length / 4) * 3 - (event.data.endsWith("==") ? 2 : event.data.endsWith("=") ? 1 : 0)
	: 0;
function captureTerminal() {
	let id: string | null = null;
	let pending: PendingEvent[] = [];
	let bytes = 0;
	let overflow = false;
	let ended = false;
	let disposed = false;
	const listeners = new Set<TerminalListener>();
	const deliver = (listener: TerminalListener, event: PendingEvent) => {
		if ("data" in event) listener.onOutput(decode(event.data));
		else listener.onExit({ exitStatus: event.exitStatus, reason: event.reason });
	};
	const detach = () => { output.remove(); exit.remove(); };
	const dispose = () => {
		disposed = true;
		detach();
		clearTimeout(deadline);
		pending = [];
		bytes = 0;
		listeners.clear();
		if (id) captures.delete(id);
	};
	const receive = (event: PendingEvent) => {
		if (disposed || ended || (id !== null && event.terminalId !== id)) return;
		if (!listeners.size) {
			pending.push(event);
			bytes += eventBytes(event);
			while (bytes > PENDING_BYTES || pending.length > PENDING_EVENTS) {
				bytes -= eventBytes(pending.shift()!);
				overflow = true;
			}
		} else listeners.forEach((listener) => deliver(listener, event));
		if (id !== null && !("data" in event)) {
			ended = true;
			detach();
			// A fast exit still needs bounded replay until the owner subscribes.
			if (listeners.size) dispose();
		}
	};
	const output = Ssh.addListener("onTerminalOutput", receive);
	const exit = Ssh.addListener("onTerminalExit", receive);
	const closeAbandoned = () => { if (id && !ended) void Ssh.closeTerminal(id).catch(() => {}); };
	const deadline = setTimeout(() => { dispose(); closeAbandoned(); }, SUBSCRIBE_TIMEOUT_MS);
	return {
		setId(terminalId: string) {
			id = terminalId;
			// The open itself may outlive the subscription deadline.
			if (disposed) { closeAbandoned(); return; }
			pending = pending.filter((event) => event.terminalId === id);
			bytes = pending.reduce((sum, event) => sum + eventBytes(event), 0);
			ended = pending.some((event) => !("data" in event));
			if (ended) detach();
			captures.set(id, this);
		},
		subscribe(listener: TerminalListener) {
			clearTimeout(deadline);
			listeners.add(listener);
			const replay = pending;
			pending = [];
			bytes = 0;
			if (overflow) {
				overflow = false;
				listener.onExit({ exitStatus: null, reason: "overflow" });
			}
			replay.forEach((event) => deliver(listener, event));
			if (ended) dispose();
			return () => { listeners.delete(listener); if (!listeners.size) dispose(); };
		},
		dispose,
	};
}
const captures = new Map<string, ReturnType<typeof captureTerminal>>();

export const sshModuleTerminalChannel: TerminalChannel = {
	open: async (connectionId, command, cols, rows, term = "xterm-256color") => {
		const capture = captureTerminal();
		try {
			const result = await Ssh.openTerminal(connectionId, command, cols, rows, term);
			if (result.ok) capture.setId(result.terminalId);
			else capture.dispose();
			return result;
		} catch (error) { capture.dispose(); throw error; }
	},
	write: (terminalId, bytes) => bytes.length > 65536
		? Promise.resolve({ ok: false, code: "TOO_LARGE", message: "A terminal write is limited to 64 KiB." })
		: Ssh.writeTerminal(terminalId, encode(bytes)),
	resize: (terminalId, cols, rows) => Ssh.resizeTerminal(terminalId, cols, rows),
	close: async (terminalId) => {
		try { await Ssh.closeTerminal(terminalId); }
		finally { captures.get(terminalId)?.dispose(); }
	},
	subscribe: (terminalId, listener) => {
		let capture = captures.get(terminalId);
		if (!capture) {
			capture = captureTerminal();
			capture.setId(terminalId);
		}
		return capture.subscribe(listener);
	},
};

export const sshModuleHostConnection: HostConnection = {
	connect: (target) => Ssh.connect(target),
	exec: (connectionId, command) => Ssh.exec(connectionId, command),
	disconnect: (connectionId) => Ssh.disconnect(connectionId),
	isConnected: (connectionId) => Ssh.isConnected(connectionId),
	homeDirectory: (connectionId) => Ssh.homeDirectory(connectionId),
	listDir: (connectionId, path) => Ssh.listDir(connectionId, path),
	readFile: (connectionId, path, maxBytes) => Ssh.readFile(connectionId, path, maxBytes),
	uploadFile: (connectionId, sourceUri, remoteDir, remoteName, maxBytes) => Ssh.uploadFile(connectionId, sourceUri, remoteDir, remoteName, maxBytes),
	removeFile: (connectionId, path) => Ssh.removeFile(connectionId, path),
	forwardLocal: (connectionId, remotePort, remoteHost = "127.0.0.1") => Ssh.forwardLocal(connectionId, remotePort, remoteHost),
	closeForward: (forwardId) => Ssh.closeForward(forwardId),
};
