// Build 15 (release-0.2.0): the tutorial learns the key bar's tab and the approval cards.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppTour, TIP_IDS, TIPS, TOUR_STEPS, parseTourFlags, type TourAnchorId, type TourFlagsStore } from "../src/core/tour";
import { TourAnchorRegistry, type Rect } from "../src/ui/tour/anchor-registry";
import { ROOT_TIPS, TIP_SETTLE_MS, TipGate, approvalTip, keyBarTabTip } from "../src/ui/tour/tip-gate";
import { es } from "../src/ui/i18n/es";
import { en } from "../src/ui/i18n/en";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const store = (): TourFlagsStore & { writes: unknown[] } => {
 const writes: unknown[] = [];
 return { writes, read: async () => ({ kind: "none" }), write: async flags => { writes.push(structuredClone(flags)); } };
};
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const place = (registry: TourAnchorRegistry, id: TourAnchorId, rect: Rect) => registry.register(id, done => done(rect));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("the terminal tip says to tap 💬, which works in every key bar mode", () => {
 expect(es.tips.lines.terminal).toEqual(["Tocá 💬 para abrir el chat.", "PREFIX envía la tecla de Herdr."]);
 expect(en.tips.lines.terminal).toEqual(["Tap 💬 to open the chat.", "PREFIX sends Herdr's key."]);
});

it("the sessions step names the agents with their badges, without adding a step", () => {
 expect(es.tour.steps.sessions).toBe("Acá vas a ver tus sesiones activas: Pi, Claude Code (◐) y Codex (⬡).");
 expect(en.tour.steps.sessions).toBe("Here you see your active sessions: Pi, Claude Code (◐) and Codex (⬡).");
 expect(TOUR_STEPS).toHaveLength(10);
});

it("defines the key bar tab's and the approval's tips, one target and one line each", () => {
 expect(TIP_IDS).toEqual(["terminal", "chatFloating", "projectSheet", "sessionSelector", "keyBarTab", "approval"]);
 expect(TIPS.keyBarTab.anchors).toEqual(["terminal.keyBarTab"]);
 expect(TIPS.approval.anchors).toEqual(["approvals.first"]);
 // The terminal's own tip does not wait for the tab, which «Siempre visible» never draws.
 expect(TIPS.terminal.anchors).toEqual(["terminal.chatHandle", "terminal.prefix"]);
 expect(es.tips.lines.keyBarTab).toEqual(["Tocá esta pestañita para mostrar u ocultar las teclas; se configura en Personalización › Personalizar teclas."]);
 expect(en.tips.lines.keyBarTab).toEqual(["Tap this tab to show or hide the keys; you set it in Personalization › Customize keys."]);
 expect(es.tips.lines.approval).toEqual(["Revisá el pedido y tocá Aprobar o Rechazar. Si no respondés, el agente pregunta en su terminal."]);
 expect(en.tips.lines.approval).toEqual(["Review the request and tap Approve or Decline. If you don't answer, the agent asks in its terminal."]);
 expect(typeof es.tips.names.keyBarTab).toBe("string"); expect(typeof es.tips.names.approval).toBe("string");
 expect(typeof en.tips.names.keyBarTab).toBe("string"); expect(typeof en.tips.names.approval).toBe("string");
 // A saved record keeps them seen.
 expect(parseTourFlags(JSON.stringify({ tourSeen: true, tips: ["keyBarTab", "approval"] })).tips).toEqual(["keyBarTab", "approval"]);
});

it("routes both tips to the root layer, over the terminal and the session screen", () => {
 expect(ROOT_TIPS).toEqual(["terminal", "chatFloating", "projectSheet", "keyBarTab", "approval"]);
});

it("the key bar tab's tip only shows where the tab exists: hidden modes with a slot, terminal free", () => {
 expect(keyBarTabTip(true, "tap", true)).toBe(true);
 expect(keyBarTabTip(true, "auto", true)).toBe(true);
 expect(keyBarTabTip(true, "always", true)).toBe(false);
 expect(keyBarTabTip(true, "tap", false)).toBe(false);
 expect(keyBarTabTip(false, "tap", true)).toBe(false);
});

it("the approval's tip only shows with a pending approval that has buttons, on a free focused screen", () => {
 const free = { focused: true, overlay: false, pending: 1, canAnswer: true };
 expect(approvalTip(free)).toBe(true);
 expect(approvalTip({ ...free, pending: 0 })).toBe(false);
 expect(approvalTip({ ...free, canAnswer: false })).toBe(false);
 expect(approvalTip({ ...free, focused: false })).toBe(false);
 expect(approvalTip({ ...free, overlay: true })).toBe(false);
});

it("shows each new tip once, never during the tour", async () => {
 for (const [id, anchor] of [["keyBarTab", "terminal.keyBarTab"], ["approval", "approvals.first"]] as const) {
  const flags = store();
  const tour = new AppTour({ store: flags });
  const registry = new TourAnchorRegistry();
  place(registry, anchor, { x: 220, y: 760, width: 48, height: 24 });
  tour.start({ hasSession: false });
  const gate = new TipGate(id, { tour, registry });
  gate.setReady(true);
  vi.advanceTimersByTime(TIP_SETTLE_MS * 2); await flush();
  expect(tour.shownTip(), id).toBeNull();
  await tour.skip(); await flush();
  vi.advanceTimersByTime(TIP_SETTLE_MS); await flush();
  expect(tour.shownTip(), id).toBe(id);
  await tour.dismissTip(id);
  expect(flags.writes.at(-1)).toEqual({ tourSeen: true, tips: [id] });
  gate.stop();
  const again = new TipGate(id, { tour, registry });
  again.setReady(true);
  vi.advanceTimersByTime(TIP_SETTLE_MS * 2); await flush();
  expect(tour.shownTip(), id).toBeNull();
  again.stop();
 }
});

it("marks the key bar tab and asks for its tip from the terminal", () => {
 const dock = source("ui/key-bar-dock.tsx");
 expect(dock).toMatch(/<TourAnchor id="terminal\.keyBarTab">\s*<Pressable accessibilityRole="button" accessibilityLabel=\{label\}/);
 const screen = source("app/session/terminal/[id].tsx");
 expect(screen).toContain(`useFirstVisitTip("keyBarTab", keyBarTabTip(tips.terminal, barMode, handleSlot !== null))`);
 expect(screen).toMatch(/useFirstVisitTip\("approval", approvalTip\(\{ focused: screenFocused, overlay: switcherOpen \|\| project !== null \|\| serverSelection !== null \|\| dictating\.needsModel, pending: sessionKey \? live\.view\?\.conversation\?\.approvals\.length \?\? 0 : 0, canAnswer: live\.view\?\.conversation\?\.capabilities\.approvals \?\? false \}\)\)/);
});

it("anchors the first approval only on the screen in front, so a screen under it never takes the target", () => {
 const list = source("ui/approvals.tsx");
 // Only the oldest approval is drawn (build 15 L5), so its card is the one target.
 expect(list).toMatch(/<TourAnchor key=\{first\.id\} id="approvals\.first" enabled=\{anchor\}/);
 expect(source("app/session/terminal/[id].tsx")).toMatch(/<ApprovalList anchor=\{screenFocused\} approvals=/);
 const session = source("app/session/[id].tsx");
 expect(session).toMatch(/<ApprovalList anchor=\{screenFocused\} approvals=/);
 expect(session).toMatch(/useFirstVisitTip\("approval", approvalTip\(\{ focused: screenFocused, overlay: dictating\.needsModel, pending: conversation\?\.approvals\.length \?\? 0, canAnswer: controls\.answerApprovals \}\)\)/);
});

it("a disabled anchor never registers, so only the enabled one is the target", () => {
 const anchors = source("ui/tour/anchors.tsx");
 expect(anchors).toMatch(/export function useTourAnchor\(id: TourAnchorId, enabled = true\)/);
 expect(anchors).toMatch(/if \(!registry \|\| !enabled\) return;/);
});
