import { describe, expect, it } from "vitest";
import { FOCUS_REFRESH_GAP_MS, SessionRefresh } from "../src/core/session-refresh";

// claude-codex-support L19 (owner decision): Home refreshes on its own when it gains focus, in the background,
// skipped when the last refresh finished less than ~10 s ago, and never two at once.
function fixture() {
	let now = 1_000_000;
	const loads: { resolve(): void; reject(error: Error): void }[] = [];
	const refresh = new SessionRefresh({
		clock: () => now,
		load: () => new Promise<void>((resolve, reject) => { loads.push({ resolve, reject }); }),
	});
	return { refresh, loads, advance: (ms: number) => { now += ms; } };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Home session refresh", () => {
	it("refreshes on the first focus", () => {
		const f = fixture();
		void f.refresh.request("focus");
		expect(f.loads).toHaveLength(1);
	});

	it("skips a focus less than ten seconds after the last refresh finished, and refreshes after", async () => {
		const f = fixture();
		const first = f.refresh.request("focus");
		f.loads[0]!.resolve();
		await first;
		f.advance(FOCUS_REFRESH_GAP_MS - 1);
		await f.refresh.request("focus");
		expect(f.loads).toHaveLength(1);
		f.advance(1);
		void f.refresh.request("focus");
		expect(f.loads).toHaveLength(2);
	});

	it("measures the gap from when the last refresh finished, not when it started", async () => {
		const f = fixture();
		const first = f.refresh.request("focus");
		f.advance(30_000);
		f.loads[0]!.resolve();
		await first;
		f.advance(5_000);
		await f.refresh.request("focus");
		expect(f.loads).toHaveLength(1);
	});

	it("never runs two at once: focus, timer and pull while one runs join it", async () => {
		const f = fixture();
		const first = f.refresh.request("focus");
		const joined = [f.refresh.request("focus"), f.refresh.request("interval"), f.refresh.request("manual")];
		expect(f.loads).toHaveLength(1);
		let done = 0;
		for (const p of joined) void p.then(() => { done++; });
		await settle();
		expect(done).toBe(0);
		f.loads[0]!.resolve();
		await first;
		await settle();
		expect(done).toBe(3);
	});

	it("does not throttle the timer or a pull to refresh", async () => {
		const f = fixture();
		const first = f.refresh.request("focus");
		f.loads[0]!.resolve();
		await first;
		void f.refresh.request("interval");
		expect(f.loads).toHaveLength(2);
		f.loads[1]!.resolve();
		await settle();
		void f.refresh.request("manual");
		expect(f.loads).toHaveLength(3);
	});

	it("a failed refresh still counts as finished and frees the next one", async () => {
		const f = fixture();
		const first = f.refresh.request("focus");
		f.loads[0]!.reject(new Error("offline"));
		await expect(first).rejects.toThrow("offline");
		await f.refresh.request("focus");
		expect(f.loads).toHaveLength(1);
		void f.refresh.request("manual");
		expect(f.loads).toHaveLength(2);
	});

	it("a refresh whose result was not shown (Home lost focus) does not throttle the next focus", async () => {
		let now = 0;
		let calls = 0;
		const refresh = new SessionRefresh({ clock: () => now, load: async () => { calls++; return calls > 1; } });
		await refresh.request("focus");
		now += 1_000;
		await refresh.request("focus");
		expect(calls).toBe(2);
		now += 1_000;
		await refresh.request("focus");
		expect(calls).toBe(2);
	});
});
