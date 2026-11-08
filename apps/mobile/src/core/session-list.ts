// Use case: the live Pi sessions of every saved computer (PRD R2, R6).
// Tunnels stay open between refreshes; a bridge that does not answer is never listed.
import { PROTOCOL_VERSION, type RegistryEntry, type StateResponse } from "@workspace/protocol";
import { needsBridgeReload } from './host-update';
import { bridgeClient, type BridgeEndpoint, type BridgeHttp } from "./bridge-client";
import { discoverBridges, openBridge } from "./bridge-discovery";
import type { SavedHost } from "./host-catalog";
import type { HostConnections } from "./host-connections";
import type { HostConnection } from "./ports";
import { orderSessions, type SessionOrder, type SessionRefreshReason } from "./session-order";

export type SessionStatus = "attention" | "working" | "done";

export type SessionSummary = {
	/** Stable across refreshes: the computer and the bridge instance. */
	key: string;
	hostId: string;
	bridgeInstanceId: string;
	terminalPane?: string;
	/** Latest settle evidence; absent on older bridges or when the outcome is unknown. */
	lastOutcome?: StateResponse["lastOutcome"];
	reloadNeeded?: boolean;
	project: string;
	cwd: string;
	status: SessionStatus;
	lastActivityAt: number;
	lastMessage: string | null;
};

export type ComputerState = "ok" | "no-pi" | "unreachable" | "locked" | "identity-changed";
export type ComputerSessions = { hostId: string; state: ComputerState; sessions: SessionSummary[]; message?: string };

export type SessionGroups = Omit<SessionOrder, "computers"> & {
	computers: (ComputerSessions & { attentionCount: number })[];
};

/** Attention is global; keep every computer and its notices, even when all its rows move up. */
export function groupSessions(previous: SessionOrder, incoming: ComputerSessions[], reason: SessionRefreshReason): SessionGroups {
	const ordered = orderSessions(previous, incoming, reason);
	const counts = new Map<string, number>();
	for (const session of ordered.needsYou) counts.set(session.hostId, (counts.get(session.hostId) ?? 0) + 1);
	return {
		...ordered,
		computers: ordered.computers.map((computer) => ({ ...computer, attentionCount: counts.get(computer.hostId) ?? 0 })),
	};
}

export type SessionListDeps = { connections: HostConnections; host: HostConnection; http: BridgeHttp };

type OpenTunnel = { connectionId: string; endpoint: BridgeEndpoint; close(): Promise<void>; lastSeq: number | null; lastMessage: string | null };

const MAX_MESSAGE_CHARS = 300;

export function statusOf(state: Pick<StateResponse, "idle" | "pendingPrompt">): SessionStatus {
	if (state.pendingPrompt !== null) return "attention";
	return state.idle ? "done" : "working";
}

/** The last part of a folder path, for Linux and Windows paths alike. */
export function projectName(cwd: string): string {
	return cwd.split(/[\\/]+/).filter(Boolean).at(-1) ?? cwd;
}

export class SessionLister {
	private readonly tunnels = new Map<string, OpenTunnel>();
	private running: Promise<ComputerSessions[]> | null = null;

	constructor(private readonly deps: SessionListDeps) {}

	/** One refresh at a time: a call while one runs gets the same answer. */
	list(hosts: SavedHost[]): Promise<ComputerSessions[]> {
		this.running ??= Promise.all(hosts.map((host) => this.computer(host))).finally(() => {
			this.running = null;
		});
		return this.running;
	}

	/** The tunnel to a listed session, for the session screen. */
	endpoint(key: string): BridgeEndpoint | null {
		return this.tunnels.get(key)?.endpoint ?? null;
	}

	async closeAll(): Promise<void> {
		await Promise.all([...this.tunnels.keys()].map((key) => this.closeTunnel(key)));
	}

	private async computer(host: SavedHost): Promise<ComputerSessions> {
		const connection = await this.deps.connections.connection(host);
		if (!connection.ok) {
			const state: ComputerState =
				connection.code === "UNLOCK_REQUIRED" ? "locked" : connection.code === "HOST_KEY_CHANGED" ? "identity-changed" : "unreachable";
			await this.closeTunnelsOf(host.id, new Set());
			return { hostId: host.id, state, sessions: [], message: connection.message };
		}
		const discovered = await discoverBridges(this.deps.host, connection.connectionId);
		if (!discovered.ok) {
			// The connection may be broken: drop it so the next refresh connects again.
			await this.closeTunnelsOf(host.id, new Set());
			await this.deps.connections.drop(host.id);
			return { hostId: host.id, state: "unreachable", sessions: [], message: discovered.message };
		}
		const keys = new Set(discovered.bridges.map((entry) => `${host.id}/${entry.bridgeInstanceId}`));
		await this.closeTunnelsOf(host.id, keys);
		const found = await Promise.all(discovered.bridges.map((entry) => this.session(host.id, connection.connectionId, entry)));
		const sessions = found.filter((s): s is SessionSummary => s !== null).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
		return { hostId: host.id, state: sessions.length === 0 ? "no-pi" : "ok", sessions };
	}

	private async session(hostId: string, connectionId: string, entry: RegistryEntry): Promise<SessionSummary | null> {
		const key = `${hostId}/${entry.bridgeInstanceId}`;
		let tunnel: OpenTunnel | null | undefined = this.tunnels.get(key);
		if (tunnel && tunnel.connectionId !== connectionId) {
			await this.closeTunnel(key);
			tunnel = undefined;
		}
		const reused = tunnel !== undefined;
		tunnel ??= await this.openTunnel(key, connectionId, entry);
		if (!tunnel) return null;
		let state = await bridgeClient.state(this.deps.http, tunnel.endpoint);
		if (!state.ok && reused) {
			// The tunnel itself may have broken while the connection stayed up: try a new one once.
			await this.closeTunnel(key);
			tunnel = await this.openTunnel(key, connectionId, entry);
			if (!tunnel) return null;
			state = await bridgeClient.state(this.deps.http, tunnel.endpoint);
		}
		if (!state.ok) {
			// The entry outlived its bridge, or the bridge is not this protocol: not a live session.
			await this.closeTunnel(key);
			return null;
		}
		if (tunnel.lastSeq !== state.value.lastSeq) {
			const history = await bridgeClient.history(this.deps.http, tunnel.endpoint);
			if (history.ok) {
				const last = history.value.messages.at(-1)?.text.trim();
				tunnel.lastMessage = last ? last.slice(0, MAX_MESSAGE_CHARS) : null;
				tunnel.lastSeq = state.value.lastSeq;
			}
		}
		return {
			key,
			hostId,
			bridgeInstanceId: entry.bridgeInstanceId,
			...(needsBridgeReload(entry.protocolVersion, PROTOCOL_VERSION) ? { reloadNeeded: true } : {}),
			...(state.value.terminalPane === undefined ? {} : { terminalPane: state.value.terminalPane }),
			...(state.value.lastOutcome === undefined ? {} : { lastOutcome: state.value.lastOutcome }),
			project: projectName(entry.cwd),
			cwd: entry.cwd,
			status: statusOf(state.value),
			lastActivityAt: state.value.lastActivityAt ?? entry.startedAt,
			lastMessage: tunnel.lastMessage,
		};
	}

	private async openTunnel(key: string, connectionId: string, entry: RegistryEntry): Promise<OpenTunnel | null> {
		const opened = await openBridge(this.deps.host, connectionId, entry);
		if (!opened.ok) return null;
		const tunnel = { connectionId, endpoint: { baseUrl: opened.baseUrl, token: opened.token }, close: opened.close, lastSeq: null, lastMessage: null };
		this.tunnels.set(key, tunnel);
		return tunnel;
	}

	private async closeTunnelsOf(hostId: string, keep: Set<string>): Promise<void> {
		const stale = [...this.tunnels.keys()].filter((key) => key.startsWith(`${hostId}/`) && !keep.has(key));
		await Promise.all(stale.map((key) => this.closeTunnel(key)));
	}

	private async closeTunnel(key: string): Promise<void> {
		const tunnel = this.tunnels.get(key);
		this.tunnels.delete(key);
		if (tunnel) await tunnel.close();
	}
}
