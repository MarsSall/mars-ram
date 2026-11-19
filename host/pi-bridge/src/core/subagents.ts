// Running subagents of this session, read from Gentle Agents' active-task
// snapshot on Pi's in-process event bus. Display only: a malformed or foreign
// snapshot is ignored, never thrown, and without any reading the state omits
// the field entirely.
import type { SubagentStatus } from "@workspace/protocol";
import type { EventBusPort, SubagentsPort, SubagentsReading } from "./ports.ts";

/** Gentle Agents answers a request, and announces every later change, on this channel. */
export const TASKS_CHANNEL = "gentle-pi:herdr-desktop:tasks";
/** Payload `{ sessionId }`: Gentle Agents answers only for its active session. */
export const TASKS_REQUEST_CHANNEL = "gentle-pi:herdr-desktop:tasks-request";

// Finished statuses (completed, failed, cancelled, timed_out) and unknown ones drop the task.
const ACTIVE: ReadonlySet<string> = new Set<SubagentStatus>(["queued", "running", "waiting"]);

type Task = { id: string; agent: string; label: string; status: SubagentStatus; question: boolean };

export class SubagentTracker implements SubagentsPort {
	private readonly clock: () => number;
	private available = false;
	private tasks: Task[] = [];
	/** When this bridge first saw each active task; the snapshot carries no start time. */
	private readonly firstSeen = new Map<string, number>();

	constructor(clock: () => number) {
		this.clock = clock;
	}

	/** Applies one snapshot if it is well formed and belongs to `sessionId`; returns whether it did. */
	apply(payload: unknown, sessionId: string): boolean {
		if (!payload || typeof payload !== "object") return false;
		const { sessionId: owner, tasks } = payload as { sessionId?: unknown; tasks?: unknown };
		if (owner !== sessionId || !Array.isArray(tasks)) return false;
		const kept: Task[] = [];
		for (const raw of tasks) {
			const task = parseTask(raw);
			if (task && !kept.some((other) => other.id === task.id)) kept.push(task);
		}
		const now = this.clock();
		for (const id of this.firstSeen.keys()) if (!kept.some((task) => task.id === id)) this.firstSeen.delete(id);
		for (const task of kept) if (!this.firstSeen.has(task.id)) this.firstSeen.set(task.id, now);
		this.tasks = kept;
		this.available = true;
		return true;
	}

	/** Forgets everything, as before any snapshot. */
	reset(): void {
		this.available = false;
		this.tasks = [];
		this.firstSeen.clear();
	}

	read(): SubagentsReading | undefined {
		if (!this.available) return undefined;
		return {
			available: true,
			items: this.tasks.map((task) => ({ ...task, since: this.firstSeen.get(task.id)! })),
		};
	}

	/**
	 * Listens for `sessionId`'s snapshots and asks for the current one. Starts from no reading.
	 * Returns the unsubscribe function; a bus that fails leaves the tracker without a reading.
	 */
	connect(bus: EventBusPort | undefined, sessionId: string): () => void {
		this.reset();
		if (!bus) return () => {};
		let off: () => void = () => {};
		try {
			off = bus.on(TASKS_CHANNEL, (payload) => {
				try {
					this.apply(payload, sessionId);
				} catch {
					// Display only: a hostile payload never reaches the session.
				}
			});
			bus.emit(TASKS_REQUEST_CHANNEL, { sessionId });
		} catch {
			// No Gentle Agents or a failing bus means no reading, never a crash.
		}
		let connected = true;
		return () => {
			if (!connected) return;
			connected = false;
			try {
				off();
			} catch {
				// Already gone.
			}
		};
	}
}

function parseTask(raw: unknown): Task | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const { id, agent, label, status, pendingQuery } = raw as Record<string, unknown>;
	if (typeof id !== "string" || id.length === 0) return undefined;
	if (typeof agent !== "string" || typeof status !== "string" || !ACTIVE.has(status)) return undefined;
	return { id, agent, label: typeof label === "string" ? label : "", status: status as SubagentStatus, question: pendingQuery === true };
}
