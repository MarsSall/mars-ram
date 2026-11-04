import type { ComputerSessions, SessionSummary } from "./session-list";

export type SessionRefreshReason = "automatic" | "focus" | "manual";
export type SessionOrder = {
	computers: ComputerSessions[];
	needsYou: SessionSummary[];
	/** Includes reserved positions for live attention sessions previously shown in a group. */
	groupOrder: Record<string, string[]>;
};

/** Keep surviving keys in place, use fresh values, then append newcomers. */
function keepOrder<T>(previous: T[], incoming: T[], key: (item: T) => string): T[] {
	const remaining = new Map(incoming.map((item) => [key(item), item]));
	const ordered: T[] = [];
	for (const old of previous) {
		const current = remaining.get(key(old));
		if (current !== undefined) {
			ordered.push(current);
			remaining.delete(key(old));
		}
	}
	return [...ordered, ...remaining.values()];
}

/** Live attention queue plus stable computer groups; no input is mutated. */
export function orderSessions(previous: SessionOrder, incoming: ComputerSessions[], reason: SessionRefreshReason): SessionOrder {
	const automatic = reason === "automatic";
	const computers = automatic ? keepOrder(previous.computers, incoming, (computer) => computer.hostId) : incoming;
	// The bridge has no attention-start timestamp: activity time approximates waiting age
	// on explicit refreshes. Between them, observed entrants always join the queue's end.
	const attention = incoming.flatMap((computer) => computer.sessions.filter((session) => session.status === "attention"))
		.sort((a, b) => a.lastActivityAt - b.lastActivityAt);
	const needsYou = automatic ? keepOrder(previous.needsYou, attention, (session) => session.key) : attention;
	const groups = computers.map((computer) => {
		const live = new Map(computer.sessions.map((session) => [session.key, session]));
		const oldSlots = previous.groupOrder[computer.hostId] ?? [];
		const survivingSlots = oldSlots.filter((key) => live.has(key));
		const visible = computer.sessions.filter((session) => session.status !== "attention");
		let slots: string[];
		if (automatic && previous.computers.some((old) => old.hostId === computer.hostId)) {
			slots = keepOrder(survivingSlots, [...survivingSlots, ...visible.map((session) => session.key)], (key) => key);
		} else {
			const sorted = [...visible].sort((a, b) => b.lastActivityAt - a.lastActivityAt).map((session) => session.key);
			// Explicit reordering changes visible rows, not reserved positions of waiting rows.
			let index = 0;
			slots = survivingSlots.flatMap((key) => {
				if (live.get(key)!.status === "attention") return [key];
				return [sorted[index++]!];
			});
			slots.push(...sorted.slice(index));
		}
		const sessions = slots.flatMap((key) => {
			const session = live.get(key)!;
			return session.status === "attention" ? [] : [session];
		});
		return { computer: { ...computer, sessions }, slots };
	});
	return {
		computers: groups.map((group) => group.computer),
		needsYou,
		groupOrder: Object.fromEntries(groups.map((group) => [group.computer.hostId, group.slots])),
	};
}
