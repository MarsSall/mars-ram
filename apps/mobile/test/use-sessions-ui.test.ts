import { beforeEach, describe, expect, it, vi } from "vitest";

// claude-codex-support L19 (owner decision): Home refreshes itself when it gains focus, keeps showing the current
// list meanwhile, skips a focus within ~10 s of the last refresh, and never runs two listings at once.
const h = vi.hoisted(() => ({
	slots: [] as unknown[],
	i: 0,
	focus: null as null | (() => (() => void) | void),
	now: 1_000_000,
	lists: [] as { resolve(value: unknown): void }[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (init: unknown) => {
		const i = h.i++;
		if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
		return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (prev: unknown) => unknown)(h.slots[i]) : next; }];
	},
	useRef: (init: unknown) => { const i = h.i++; if (!(i in h.slots)) h.slots[i] = { current: init }; return h.slots[i]; },
	useCallback: (fn: unknown) => fn,
}));
vi.mock("expo-router", () => ({ useFocusEffect: (effect: () => (() => void) | void) => { h.focus = effect; } }));
vi.mock("../src/services", () => ({
	sessions: {
		list: () => new Promise((resolve) => { h.lists.push({ resolve }); }),
		allowUnlockAgain: () => {},
	},
}));

const { useSessions } = await import("../src/ui/use-sessions");

const listing = (n: number) => ({ hosts: [], computers: [{ hostId: `h${n}`, state: "ok", sessions: [] }], updates: {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function render() { h.i = 0; return useSessions(); }
/** Home gains focus; returns its blur. */
function focus() { render(); return h.focus!() ?? (() => {}); }

beforeEach(() => {
	h.slots = []; h.i = 0; h.focus = null; h.lists = [];
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
	vi.setSystemTime(h.now);
});

describe("Home refresh on focus", () => {
	it("refreshes in the background on focus and keeps the current list on screen meanwhile", async () => {
		let blur = focus();
		expect(h.lists).toHaveLength(1);
		h.lists[0]!.resolve(listing(1));
		await settle();
		expect(render().data?.computers[0]!.hostId).toBe("h1");
		blur();

		vi.setSystemTime(h.now + 60_000);
		blur = focus();
		expect(h.lists).toHaveLength(2);
		// No blanking or spinner while it runs.
		expect(render()).toMatchObject({ refreshing: false, data: { computers: [{ hostId: "h1" }] } });
		h.lists[1]!.resolve(listing(2));
		await settle();
		expect(render().data?.computers[0]!.hostId).toBe("h2");
		blur();
	});

	it("skips a focus within ten seconds of the last refresh, and refreshes after", async () => {
		let blur = focus();
		h.lists[0]!.resolve(listing(1));
		await settle();
		blur();
		vi.setSystemTime(h.now + 9_000);
		blur = focus();
		expect(h.lists).toHaveLength(1);
		blur();
		vi.setSystemTime(h.now + 10_000);
		blur = focus();
		expect(h.lists).toHaveLength(2);
		blur();
	});

	it("never runs two listings at once, even when focus comes back while one runs", () => {
		let blur = focus();
		blur();
		blur = focus();
		expect(h.lists).toHaveLength(1);
		vi.advanceTimersByTime(10_000);
		expect(h.lists).toHaveLength(1);
		blur();
	});

	it("refreshes again on focus when the last listing finished after Home lost focus", async () => {
		let blur = focus();
		blur();
		h.lists[0]!.resolve(listing(1));
		await settle();
		blur = focus();
		expect(h.lists).toHaveLength(2);
		h.lists[1]!.resolve(listing(2));
		await settle();
		expect(render().data?.computers[0]!.hostId).toBe("h2");
		blur();
	});
});
