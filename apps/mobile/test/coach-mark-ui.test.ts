import { isValidElement } from "react";
import { expect, it, vi } from "vitest";
import { presentStep, startRun, TOUR_STEPS } from "../src/core/tour";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { layoutCoachMark } from "../src/ui/tour/coach-layout";
import { CoachMarkView, type CoachMarkViewProps } from "../src/ui/tour/coach-mark-view";
import { themes } from "../src/ui/theme";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Animated: { View: "Animated.View" } }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));

type Node = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Node[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const texts = (nodes: Node[]) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join(""));
const button = (nodes: Node[], label: string) => nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label);
const style = (node: Node) => Object.assign({}, ...[node.props.style].flat());
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const boxOf = (s: Record<string, number>): Box => ({ x: s.left, y: s.top, width: s.width, height: s.height });

const window = { width: 360, height: 780 };
const insets = { top: 24, bottom: 0 };
const theme = themes["verde-profundo"];
const artboard: Record<string, Box> = {
 sessions: { x: 10, y: 206, width: 340, height: 418 },
 tabs: { x: 92, y: 704, width: 88, height: 62 },
 diffs: { x: 309, y: 0, width: 44, height: 42 },
 addComputer: { x: 296, y: 44, width: 52, height: 52 },
 createLink: { x: 26, y: 176, width: 308, height: 56 },
 notifications: { x: 10, y: 470, width: 340, height: 88 },
};
type TourViewProps = Extract<CoachMarkViewProps, { variant: "tour" }>;
/** The artboard's nine steps: this build has no «Abrir terminal» tile on Inicio. */
const run = startRun({ hasSession: true });
const tourProps = (index: number, extra: Partial<TourViewProps> = {}): TourViewProps => ({
 variant: "tour", presentation: presentStep({ ...run, index }), targets: [artboard[run.steps[index].id]].filter(Boolean),
 window, insets, bubbleHeight: 96, theme, t: es, reduceMotion: false, pulse: { scale: 1, opacity: 0.9 },
 onTarget: vi.fn(), onSkip: vi.fn(), onNext: vi.fn(), ...extra,
});

it("places the bubble on the roomier side, never over the target, and keeps «Saltar recorrido» away from both", () => {
 for (const [id, target] of Object.entries(artboard)) {
  const layout = layoutCoachMark({ target, window, insets, bubbleHeight: 96 });
  const bubble = { x: layout.bubble.left, y: layout.bubble.top, width: layout.bubble.width, height: 96 };
  expect(overlaps(bubble, target), id).toBe(false);
  expect(bubble.x).toBeGreaterThanOrEqual(16);
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(window.width - 16);
  expect(bubble.y).toBeGreaterThanOrEqual(insets.top);
  expect(bubble.y + bubble.height).toBeLessThanOrEqual(window.height);
  const skip = { x: window.width - 12 - layout.skip.width, y: layout.skip.top, width: layout.skip.width, height: 48 };
  expect(overlaps(skip, target), id).toBe(false);
  expect(overlaps(skip, bubble), id).toBe(false);
 }
 expect(layoutCoachMark({ target: artboard.sessions, window, insets, bubbleHeight: 96 }).side).toBe("above");
 expect(layoutCoachMark({ target: artboard.diffs, window, insets, bubbleHeight: 96 }).side).toBe("below");
 expect(layoutCoachMark({ target: null, window, insets, bubbleHeight: 96 })).toMatchObject({ side: "center", hand: null, notchLeft: null });
});

it("rings the real control, points the hand at it and says «N de 9 · Tocalo para seguir» with the step sentence", () => {
 const nodes = elements(CoachMarkView(tourProps(2)));
 expect(texts(nodes)).toEqual(expect.arrayContaining(["Acá ves los cambios y diffs del proyecto.", "3 de 9 · Tocalo para seguir"]));
 const ring = nodes.find(n => n.props.testID === "tour-ring")!;
 expect(style(ring)).toMatchObject({ left: 306, top: -3, width: 50, height: 48, borderColor: theme.colors.accentText });
 expect(ring.props.pointerEvents).toBe("none");
 const halo = nodes.find(n => n.props.testID === "tour-halo")!;
 expect(style(halo).borderColor).toBe(theme.colors.accent);
 const pulse = nodes.find(n => n.props.testID === "tour-pulse")!;
 expect(pulse.type).toBe("Animated.View");
 expect(nodes.find(n => n.type === "Ionicons")?.props.name).toBe("hand-left");
 const bubble = nodes.find(n => n.props.testID === "tour-bubble")!;
 expect(bubble.props.accessibilityLiveRegion).toBe("polite");
 expect(bubble.props.accessibilityLabel).toBe("Recorrido, paso 3 de 9. Acá ves los cambios y diffs del proyecto.");
});

it("uses a static dashed ring under reduced motion", () => {
 const nodes = elements(CoachMarkView(tourProps(2, { reduceMotion: true, pulse: null })));
 expect(nodes.some(n => n.props.testID === "tour-pulse")).toBe(false);
 expect(style(nodes.find(n => n.props.testID === "tour-dashed")!)).toMatchObject({ borderStyle: "dashed", borderColor: theme.colors.accentText });
});

it("on an action step the tap on the target only advances; elsewhere nothing happens", () => {
 const props = tourProps(4);
 const nodes = elements(CoachMarkView(props));
 const target = nodes.find(n => n.props.testID === "tour-target")!;
 expect(style(target)).toMatchObject({ left: 296, top: 44, width: 52, height: 52 });
 target.props.onPress();
 expect(props.onTarget).toHaveBeenCalledOnce();
 const blockers = nodes.filter(n => n.props.testID === "tour-blocker");
 expect(blockers.length).toBeGreaterThan(0);
 for (const blocker of blockers) expect(blocker.props.onStartShouldSetResponder()).toBe(true);
});

it("on a navigate step the target is left open so the real tab gets the tap", () => {
 const nodes = elements(CoachMarkView(tourProps(1)));
 expect(nodes.some(n => n.props.testID === "tour-target")).toBe(false);
 const blockers = nodes.filter(n => n.props.testID === "tour-blocker").map(n => boxOf(style(n)));
 expect(blockers).toHaveLength(4);
 for (const blocker of blockers) expect(overlaps(blocker, artboard.tabs)).toBe(false);
 // Together they cover the rest of the screen.
 const area = blockers.reduce((sum, b) => sum + b.width * b.height, 0);
 expect(area).toBe(window.width * window.height - artboard.tabs.width * artboard.tabs.height);
 expect(texts(elements(CoachMarkView(tourProps(1))))).toContain("2 de 9 · Tocá la barra para seguir");
});

it("«Saltar recorrido» is a 48 dp named button, away from the bubble", () => {
 const props = tourProps(0);
 const nodes = elements(CoachMarkView(props));
 const skip = button(nodes, "Saltar recorrido")!;
 expect(skip.props.accessibilityRole).toBe("button");
 expect(style(skip).minHeight).toBeGreaterThanOrEqual(48);
 skip.props.onPress();
 expect(props.onSkip).toHaveBeenCalledOnce();
});

it("without a session steps 3-4 explain with «Siguiente», and step 9 closes with «Empezar»", () => {
 const explain = tourProps(3, { presentation: presentStep({ ...startRun({ hasSession: false }), index: 3 }), targets: [] });
 const nodes = elements(CoachMarkView(explain));
 expect(nodes.some(n => n.props.testID === "tour-ring")).toBe(false);
 expect(texts(nodes)).toEqual(expect.arrayContaining([es.tour.explainContext, "Tocá acá para ver agentes y workspaces.", "4 de 9"]));
 button(nodes, "Siguiente")!.props.onPress();
 expect(explain.onNext).toHaveBeenCalledOnce();
 const finish = tourProps(8, { targets: [] });
 const last = elements(CoachMarkView(finish));
 expect(texts(last)).toContain("Listo: ya sabés dónde está cada cosa.");
 expect(button(last, "Saltar recorrido")).toBeUndefined();
 button(last, "Empezar")!.props.onPress();
 expect(finish.onNext).toHaveBeenCalledOnce();
});

it("the tip variant rings each target, has «Entendido» and no counter or skip", () => {
 const onDone = vi.fn();
 const nodes = elements(CoachMarkView({ variant: "tip", tip: "terminal", targets: [{ x: 11, y: 647, width: 48, height: 48 }, { x: 77, y: 708, width: 46, height: 46 }], window, insets, bubbleHeight: 120, theme, t: es, reduceMotion: false, pulse: { scale: 1, opacity: 0.9 }, onDone }));
 expect(nodes.filter(n => n.props.testID === "tour-ring")).toHaveLength(2);
 expect(texts(nodes)).toEqual(expect.arrayContaining(["Sugerencia · Terminal", "Deslizá hacia arriba para el chat.", "PREFIX envía la tecla de Herdr.", "1", "2"]));
 expect(texts(nodes).some(line => / de 9/.test(line))).toBe(false);
 expect(button(nodes, "Saltar recorrido")).toBeUndefined();
 const done = button(nodes, "Entendido")!;
 expect(style(done).minHeight).toBeGreaterThanOrEqual(48);
 done.props.onPress();
 expect(onDone).toHaveBeenCalledOnce();
});

it("carries the spec's copy in Spanish and the same keys in English", () => {
 expect(TOUR_STEPS.map(s => es.tour.steps[s.id])).toEqual([
  "Acá vas a ver tus sesiones activas.", "Acá abrís una terminal en la computadora que elijas.", "Con estas pestañas te movés por la app.", "Acá ves los cambios y diffs del proyecto.", "Tocá acá para ver agentes y workspaces.",
  "Tocá + para agregar otra computadora.", "«Crear link» te da un link privado por 24 h.", "Acá elegís los avisos, como Siempre atento.", "En Acerca de, «Ver tutorial» repite este recorrido.", "Listo: ya sabés dónde está cada cosa.",
 ]);
 expect(es.tips.lines).toEqual({ terminal: ["Deslizá hacia arriba para el chat.", "PREFIX envía la tecla de Herdr."], chatFloating: ["Lo que escribas acá le llega al agente."], projectSheet: ["Acá ves archivos, cambios y ramas del proyecto."], sessionSelector: ["Tocá el nombre para cambiar de sesión."] });
 expect(es.tour).toMatchObject({ skip: "Saltar recorrido", start: "Empezar", open: "Ver tutorial" });
 expect(es.tips.done).toBe("Entendido");
 const keys = (value: object): string[] => Object.entries(value).flatMap(([k, v]) => v && typeof v === "object" && !Array.isArray(v) ? keys(v).map(n => `${k}.${n}`) : [k]).sort();
 expect(keys(en.tour)).toEqual(keys(es.tour));
 expect(keys(en.tips)).toEqual(keys(es.tips));
 expect(en.tips.lines.terminal).toHaveLength(2);
 expect(en.tour.counter(3, 9)).toBe("3 of 9");
});
