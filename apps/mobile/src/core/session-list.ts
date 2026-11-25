// Use case: the live Pi sessions of every saved computer (PRD R2, R6).
// Tunnels stay open between refreshes; a bridge that does not answer is never listed.
import {
	boundApprovals,
	boundSubagents,
	LEGACY_PI_CAPABILITIES,
	NO_CAPABILITIES,
	sessionCapabilities,
	type AgentKind,
	type ApprovalRequest,
	type Capabilities,
	type RegistryEntry,
	type StateResponse,
	type SubagentItem,
} from "@workspace/protocol";
import { piBridgeReloadNeeded } from './host-update';
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
	/** Runs in a terminal pane the app can drive (Herdr); older bridges report this without terminalPane. */
	terminal?: true;
	terminalPane?: string;
	/** Latest settle evidence; absent on older bridges or when the outcome is unknown. */
	lastOutcome?: StateResponse["lastOutcome"];
	reloadNeeded?: boolean;
	project: string;
	cwd: string;
	status: SessionStatus;
	lastActivityAt: number;
	lastMessage: string | null;
	/** Since protocol 1.8: the session's subagents, bounded; absent when the bridge reports none or cannot know. */
	subagents?: SubagentItem[];
	/** Since protocol 1.9: the agent when it is not Pi; absent means Pi. */
	agent?: Exclude<AgentKind, "pi"> | "unknown";
	/** Since protocol 1.9: set when the bridge declares them or is not Pi; absent means a Pi bridge with every Pi feature. */
	capabilities?: Capabilities;
	/** Since protocol 1.9: pending approvals, bounded; absent when there are none. */
	approvals?: ApprovalRequest[];
};

/** What a listed session can do: what it declared, or every Pi feature for a Pi bridge without capabilities. */
export function summaryCapabilities(session: Pick<SessionSummary, "agent" | "capabilities">): Capabilities {
	return session.capabilities ?? (session.agent === undefined ? LEGACY_PI_CAPABILITIES : NO_CAPABILITIES);
}

/** The agent and capabilities of a session: the state wins, the registry entry stands in for a field the state omits. */
export function agentOf(entry: Pick<RegistryEntry, "agent" | "capabilities">, state: Pick<StateResponse, "agent" | "capabilities">) {
	const source = { agent: state.agent ?? entry.agent, capabilities: state.capabilities ?? entry.capabilities };
	const resolved = sessionCapabilities(source);
	return { ...resolved, declared: source.capabilities !== undefined };
}

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

/**
 * claude-codex L21: Claude Code's idle Notification («Claude is waiting for your input») reaches the bridge as an
 * `input` prompt while the agent is idle. It fires whenever Claude Code just sits there, so it is not a question:
 * the session is done. A Claude Code `input` prompt while it works (an MCP question) and every Pi prompt still count.
 */
export function idleReminder(agent: AgentKind | "unknown" | undefined, state: Pick<StateResponse, "idle" | "pendingPrompt">): boolean {
	return agent === "claude-code" && state.idle && state.pendingPrompt?.kind === "input";
}

export function statusOf(state: Pick<StateResponse, "idle" | "pendingPrompt">, agent?: AgentKind | "unknown"): SessionStatus {
	if (state.pendingPrompt !== null && !idleReminder(agent, state)) return "attention";
	return state.idle ? "done" : "working";
}

/** The subagents to show: absent on older bridges, `available: false`, or an empty list (S3, S6). */
export function subagentsOf(raw: unknown): SubagentItem[] | undefined {
	const { items } = boundSubagents(raw);
	return items.length > 0 ? items : undefined;
}

/** A subagent asking a question, or a pending approval, needs the user even while the session works (S5, S7). */
export function summaryStatus(state: Pick<StateResponse, "idle" | "pendingPrompt">, subagents: SubagentItem[] | undefined, approvals: readonly ApprovalRequest[] = [], agent?: AgentKind | "unknown"): SessionStatus {
	return approvals.length > 0 || subagents?.some((item) => item.question) ? "attention" : statusOf(state, agent);
}

/** The last part of a folder path, for Linux and Windows paths alike. */
export function projectName(cwd: string): string {
	return cwd.split(/[\\/]+/).filter(Boolean).at(-1) ?? cwd;
}

const MAX_IDENTITIES = 256;

/** What identifies a listed session beyond its bridge instance: its agent session and its Herdr pane. */
export type SessionIdentity = { hostId: string; sessionId: string; terminalPane?: string };

/**
 * The live session that replaced a stale key on the same computer: the one bridge of the same agent session
 * (a restarted bridge), else the one session in the same Herdr pane (a new session there, such as /clear).
 * Ambiguity is no answer.
 */
export function successorKey(old: SessionIdentity & { key: string }, live: readonly (SessionIdentity & { key: string })[]): string | undefined {
	const others = live.filter((s) => s.key !== old.key && s.hostId === old.hostId);
	const same = others.filter((s) => s.sessionId === old.sessionId);
	if (same.length > 0) return same.length === 1 ? same[0]!.key : undefined;
	if (old.terminalPane === undefined) return undefined;
	const pane = others.filter((s) => s.terminalPane === old.terminalPane);
	return pane.length === 1 ? pane[0]!.key : undefined;
}

export class SessionLister {
	private readonly tunnels = new Map<string, OpenTunnel>();
	private running: Promise<ComputerSessions[]> | null = null;
	/** What each recently listed key was, kept after it disappears so a stale card can find its successor. */
	private readonly identities = new Map<string, SessionIdentity>();
	/** The keys of each computer's latest listing. */
	private readonly listed = new Map<string, string[]>();

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

	/** After a listing: the live session that replaced a key no longer listed (see successorKey). */
	successor(key: string): string | undefined {
		const old = this.identities.get(key);
		if (!old) return undefined;
		const live = (this.listed.get(old.hostId) ?? []).flatMap((k) => {
			const identity = this.identities.get(k);
			return identity ? [{ ...identity, key: k }] : [];
		});
		return successorKey({ ...old, key }, live);
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
			this.listed.set(host.id, []);
			return { hostId: host.id, state, sessions: [], message: connection.message };
		}
		const discovered = await discoverBridges(this.deps.host, connection.connectionId);
		if (!discovered.ok) {
			// The connection may be broken: drop it so the next refresh connects again.
			await this.closeTunnelsOf(host.id, new Set());
			await this.deps.connections.drop(host.id);
			this.listed.set(host.id, []);
			return { hostId: host.id, state: "unreachable", sessions: [], message: discovered.message };
		}
		const keys = new Set(discovered.bridges.map((entry) => `${host.id}/${entry.bridgeInstanceId}`));
		await this.closeTunnelsOf(host.id, keys);
		const found = await Promise.all(discovered.bridges.map((entry) => this.session(host.id, connection.connectionId, entry)));
		const sessions = found.filter((s): s is SessionSummary => s !== null).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
		this.listed.set(host.id, sessions.map((s) => s.key));
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
		const subagents = subagentsOf(state.value.subagents);
		const { agent, capabilities, declared } = agentOf(entry, state.value);
		const approvals = boundApprovals(state.value.approvals);
		this.remember(key, { hostId, sessionId: state.value.sessionId, ...(state.value.terminalPane === undefined ? {} : { terminalPane: state.value.terminalPane }) });
		return {
			key,
			hostId,
			bridgeInstanceId: entry.bridgeInstanceId,
			// /reload is a Pi command, and only a Pi bridge older than the app's Pi features needs it.
			...(agent === "pi" && piBridgeReloadNeeded(entry.protocolVersion) ? { reloadNeeded: true } : {}),
			...(state.value.terminal === true ? { terminal: true as const } : {}),
			...(state.value.terminalPane === undefined ? {} : { terminalPane: state.value.terminalPane }),
			...(state.value.lastOutcome === undefined ? {} : { lastOutcome: state.value.lastOutcome }),
			project: projectName(entry.cwd),
			cwd: entry.cwd,
			status: summaryStatus(state.value, subagents, approvals, agent),
			lastActivityAt: state.value.lastActivityAt ?? entry.startedAt,
			lastMessage: tunnel.lastMessage,
			...(subagents ? { subagents } : {}),
			...(agent === "pi" ? {} : { agent }),
			...(agent !== "pi" || declared ? { capabilities } : {}),
			...(approvals.length > 0 ? { approvals } : {}),
		};
	}

	private remember(key: string, identity: SessionIdentity): void {
		this.identities.delete(key);
		this.identities.set(key, identity);
		// Bounded: the oldest identities go first.
		for (const old of this.identities.keys()) {
			if (this.identities.size <= MAX_IDENTITIES) break;
			this.identities.delete(old);
		}
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
