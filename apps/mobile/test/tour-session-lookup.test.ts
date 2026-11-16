// Phone check: with several Herdr sessions in Inicio, steps 3-4 still only explained (L7).
import { expect, it } from "vitest";
import type { ComputerSessions, SessionSummary } from "../src/core/session-list";
import { AppTour, findTourSession, tourSession, type TourFlagsStore, type TourSession } from "../src/core/tour";

const store: TourFlagsStore = { read: async () => ({ kind: "none" }), write: async () => {} };
const summary = (hostId: string, id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
 key: `${hostId}/${id}`, hostId, bridgeInstanceId: id, project: id, cwd: `/home/alex/${id}`, status: "done", lastActivityAt: 1, lastMessage: null, ...extra,
});
const hosts = [{ id: "mini", name: "devbox" }];
const computer = (sessions: SessionSummary[]): ComputerSessions => ({ hostId: "mini", state: "ok", sessions });
const session: TourSession = { key: "mini/api", project: "api", cwd: "/home/alex/api", computer: "devbox" };
const never = () => new Promise<never>(() => {});

it("takes a session that runs in a terminal even when its bridge does not report the pane", () => {
 expect(tourSession(hosts, [computer([summary("mini", "chat-only"), summary("mini", "api", { terminal: true })])])).toEqual(session);
});

it("uses the sessions Inicio already shows, without waiting for a new list", async () => {
 const shown = { hosts, computers: [computer([summary("mini", "api", { terminalPane: "w1:p1" })])] };
 expect(await findTourSession({ shown: () => shown, list: never, timeoutMs: 5_000, wait: never })).toEqual(session);
});

it("lists again when Inicio shows no terminal session yet, and gives up after the timeout", async () => {
 const listed = { hosts, computers: [computer([summary("mini", "api", { terminal: true })])] };
 expect(await findTourSession({ shown: () => null, list: async () => listed, timeoutMs: 5_000, wait: never })).toEqual(session);
 expect(await findTourSession({ shown: () => ({ hosts, computers: [] }), list: async () => listed, timeoutMs: 5_000, wait: never })).toEqual(session);
 expect(await findTourSession({ shown: () => null, list: never, timeoutMs: 5_000, wait: async () => {} })).toBeNull();
 expect(await findTourSession({ shown: () => null, list: () => Promise.reject(new Error("ssh")), timeoutMs: 5_000, wait: never })).toBeNull();
});

it("waits for a lookup still running before it shows step 3, then opens the session", async () => {
 let answer!: (found: TourSession | null) => void;
 const tour = new AppTour({ store });
 const begun = tour.begin(() => new Promise(done => { answer = done; }));
 await tour.advance();
 const toStep3 = tour.advance();
 // Still on step 2 while the session is looked up; a second tap does not skip ahead.
 expect(tour.current()).toMatchObject({ number: 2 });
 void tour.advance();
 answer(session); await begun; await toStep3;
 expect(tour.current()).toMatchObject({ number: 3, mode: "target", anchor: "terminal.project", screen: "terminal" });
 expect(tour.session()).toEqual(session);
});

it("explains steps 3-4 when the lookup answers none, after waiting for it", async () => {
 let answer!: (found: TourSession | null) => void;
 const tour = new AppTour({ store });
 const begun = tour.begin(() => new Promise(done => { answer = done; }));
 await tour.advance();
 const toStep3 = tour.advance();
 answer(null); await begun; await toStep3;
 expect(tour.current()).toMatchObject({ number: 3, mode: "explain", screen: "home" });
});
