import { expect, it } from "vitest";
import { registerSecretTap, type SecretTapResult, type SecretTaps } from "../src/core/secret-taps";

function tapAt(times: number[]): SecretTapResult[] {
 let state: SecretTaps | null = null;
 return times.map(time => { const result = registerSecretTap(state, time); state = result.state; return result; });
}

it("opens on the seventh quick tap and hints the rest from the fourth", () => {
 const results = tapAt([0, 400, 800, 1200, 1600, 2000, 2400]);
 expect(results.map(result => result.open)).toEqual([false, false, false, false, false, false, true]);
 expect(results.map(result => result.remaining)).toEqual([null, null, null, 3, 2, 1, null]);
});

it("starts over after a pause longer than 1.5 s", () => {
 const results = tapAt([0, 500, 1000, 1500, 3100, 3500, 3900, 4300, 4700, 5100, 5500]);
 expect(results.map(result => result.open)).toEqual([false, false, false, false, false, false, false, false, false, false, true]);
 expect(results[4].remaining).toBeNull();
});

it("accepts a gap of exactly 1.5 s", () => {
 expect(tapAt([0, 1500, 3000, 4500, 6000, 7500, 9000]).at(-1)!.open).toBe(true);
});

it("needs seven new taps after opening", () => {
 const results = tapAt([0, 100, 200, 300, 400, 500, 600, 700, 800]);
 expect(results[6].open).toBe(true);
 expect(results.slice(7).map(result => result.open)).toEqual([false, false]);
 expect(results[7].state.count).toBe(1);
});

it("treats a clock going backwards as a new run", () => {
 const results = tapAt([5000, 5100, 5200, 100]);
 expect(results[3].state.count).toBe(1);
});
