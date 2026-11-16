import { expect, it } from "vitest";
import type { ComputerSessions, SessionSummary } from "../src/core/session-list";
import { AppTour, pairAndCheckTour, presentStep, startRun, tourSession, type TourFlagsRecord, type TourFlagsStore, type TourSession } from "../src/core/tour";
import { terminalParams, tourNavigation } from "../src/ui/tour/tour-navigation";

function fakeStore(initial: TourFlagsRecord): TourFlagsStore {
 let record = initial;
 return { read: async () => record, write: async flags => { record = { kind: "saved", flags }; } };
}
const fresh = () => new AppTour({ store: fakeStore({ kind: "none" }) });
const seen = () => new AppTour({ store: fakeStore({ kind: "saved", flags: { tourSeen: true, tips: [] } }) });

const summary = (hostId: string, id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
 key: `${hostId}/${id}`, hostId, bridgeInstanceId: id, project: id, cwd: `/home/alex/${id}`, status: "done", lastActivityAt: 1, lastMessage: null, ...extra,
});
const hosts = [{ id: "mini", name: "devbox" }, { id: "desk", name: "escritorio" }];
const computer = (hostId: string, sessions: SessionSummary[]): ComputerSessions => ({ hostId, state: "ok", sessions });
const session: TourSession = { key: "mini/api", project: "api", cwd: "/home/alex/api", computer: "devbox" };

it("starts the tour after the first pairing, and not after a second one or a failed one", async () => {
 const run = (savedHosts: number, ok: boolean, tour = fresh()) => pairAndCheckTour({ savedHosts: async () => savedHosts, tour }, async () => ({ ok }));
 expect(await run(0, true)).toEqual({ result: { ok: true }, startTour: true });
 expect((await run(1, true)).startTour).toBe(false);
 expect((await run(0, false)).startTour).toBe(false);
 expect((await run(0, true, seen())).startTour).toBe(false);
});

it("counts the saved computers before the pairing saves the new one", async () => {
 let saved = 0;
 const result = await pairAndCheckTour({ savedHosts: async () => saved, tour: fresh() }, async () => { saved = 1; return { ok: true }; });
 expect(result.startTour).toBe(true);
});

it("does not start when the saved computers cannot be counted", async () => {
 const result = await pairAndCheckTour({ savedHosts: () => Promise.reject(new Error("disk")), tour: fresh() }, async () => ({ ok: true as const, host: "x" }));
 expect(result).toEqual({ result: { ok: true, host: "x" }, startTour: false });
});

it("picks the first session in Inicio's order that runs in a terminal (Herdr)", () => {
 const computers = [
  computer("mini", [summary("mini", "chat-only"), summary("mini", "api", { terminalPane: "w1:1" })]),
  computer("desk", [summary("desk", "web", { terminalPane: "w2:1" })]),
 ];
 expect(tourSession(hosts, computers)).toEqual(session);
 // Sessions that need you come first in Inicio.
 const waiting = [computers[0], computer("desk", [summary("desk", "ask", { terminalPane: "w3:1", status: "attention" })])];
 expect(tourSession(hosts, waiting)).toMatchObject({ key: "desk/ask", computer: "escritorio" });
});

it("finds no session without a terminal one, or without computers", () => {
 expect(tourSession(hosts, [computer("mini", [summary("mini", "chat-only")])])).toBeNull();
 expect(tourSession(hosts, [])).toBeNull();
 expect(tourSession([], [computer("gone", [summary("gone", "api", { terminalPane: "w1:1" })])])).toBeNull();
});

it("begins with the session found, so steps 3-4 target the open terminal", async () => {
 const tour = fresh();
 await tour.begin(async () => session);
 expect(tour.current()).toMatchObject({ number: 1, mode: "target" });
 expect(tour.session()).toEqual(session);
 await tour.advance(); await tour.advance();
 expect(tour.current()).toMatchObject({ number: 3, mode: "target", anchor: "terminal.project", screen: "terminal" });
});

it("begins explain-only for steps 3-4 when there is no session or the lookup fails", async () => {
 for (const find of [async () => null, () => Promise.reject(new Error("unreachable"))]) {
  const tour = fresh();
  await tour.begin(find);
  expect(tour.session()).toBeNull();
  await tour.advance(); await tour.advance();
  expect(tour.current()).toMatchObject({ number: 3, mode: "explain", anchor: null, screen: "home" });
 }
});

it("shows step 1 at once while the session is looked up, and a late answer does not change step 3 once shown", async () => {
 let answer!: (found: TourSession | null) => void;
 const tour = fresh();
 const begun = tour.begin(() => new Promise(done => { answer = done; }));
 expect(tour.current()).toMatchObject({ number: 1 });
 answer(session); await begun;
 await tour.advance(); await tour.advance();
 expect(tour.current()).toMatchObject({ number: 3, mode: "target" });

 // A lookup that gave up (null) explains step 3; a later answer to another lookup is ignored.
 const late = fresh();
 const pending = late.begin(async () => null);
 await pending;
 await late.advance(); await late.advance();
 const explained = late.current();
 expect(explained).toMatchObject({ number: 3, mode: "explain" });
 // A tour skipped while its lookup runs stays ended when the answer arrives.
 const again = late.begin(() => new Promise(done => { answer = done; }));
 await late.skip();
 answer(session); await again;
 expect(late.current()).toBeNull();
 expect(late.session()).toBeNull();
});

it("«Ver tutorial» starts it even after it was seen, and forgets the session when it ends", async () => {
 const tour = seen();
 await tour.begin(async () => session);
 expect(tour.isRunning()).toBe(true);
 await tour.skip();
 expect(tour.current()).toBeNull();
 expect(tour.session()).toBeNull();
});

it("keeps the same snapshot between changes, as useSyncExternalStore needs", async () => {
 const tour = fresh();
 tour.start({ hasSession: false });
 const first = tour.current();
 expect(tour.current()).toBe(first);
 await tour.advance();
 expect(tour.current()).not.toBe(first);
 expect(tour.current()).toBe(tour.current());
});

const at = (index: number, hasSession: boolean) => presentStep({ ...startRun({ hasSession }), index });

it("shows each step's tab, leaving a screen above the tabs first", () => {
 expect(tourNavigation(at(0, true), "/computer/mini", null)).toEqual({ kind: "tab", route: "/", leave: true });
 expect(tourNavigation(at(0, true), "/settings", null)).toEqual({ kind: "tab", route: "/", leave: false });
 expect(tourNavigation(at(0, true), "/", null)).toEqual({ kind: "stay" });
 expect(tourNavigation(at(1, true), "/", null)).toEqual({ kind: "stay" });
 // From the terminal the tour opened back to the tabs.
 expect(tourNavigation(at(4, true), "/session/terminal/mini%2Fapi", session)).toEqual({ kind: "tab", route: "/computers", leave: true });
 expect(tourNavigation(at(5, false), "/computers", null)).toEqual({ kind: "tab", route: "/files", leave: false });
 expect(tourNavigation(at(6, false), "/files", null)).toEqual({ kind: "tab", route: "/settings", leave: false });
 expect(tourNavigation(at(7, false), "/settings", null)).toEqual({ kind: "stay" });
 // The last step returns to Inicio.
 expect(tourNavigation(at(8, false), "/settings", null)).toEqual({ kind: "tab", route: "/", leave: false });
});

it("opens the session's terminal once for steps 3-4, and without a session opens nothing and explains them on Inicio", () => {
 expect(tourNavigation(at(2, true), "/files", session)).toEqual({ kind: "terminal", session });
 expect(tourNavigation(at(3, true), "/session/terminal/mini%2Fapi", session)).toEqual({ kind: "stay" });
 expect(tourNavigation(at(2, false), "/files", null)).toEqual({ kind: "tab", route: "/", leave: false });
 expect(tourNavigation(at(3, false), "/computers", null)).toEqual({ kind: "tab", route: "/", leave: false });
 expect(tourNavigation(null, "/", session)).toEqual({ kind: "stay" });
 expect(terminalParams(session)).toEqual({ id: "mini/api", project: "api", cwd: "/home/alex/api", computer: "devbox" });
});
