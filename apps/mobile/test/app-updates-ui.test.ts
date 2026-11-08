import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { AppUpdateNotice } from "../src/ui/app-update-notice";

const f = vi.hoisted(() => ({ state: { phase: "idle", dismissed: false }, update: vi.fn(async () => {}), restart: vi.fn(async () => {}), dismiss: vi.fn() }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useSyncExternalStore: () => f.state }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
vi.mock("../src/services", () => ({ appUpdates: { subscribe: vi.fn(), snapshot: vi.fn(), update: f.update, restart: f.restart, dismiss: f.dismiss } }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: () => ({ t: es, theme: { touch: 48, spacing: (n: number) => n * 4, radius: { medium: 12 }, colors: { text: "white", textMuted: "gray", accentText: "green", surfaceRaised: "dark", border: "line" } } }) }));

function elements(node: unknown): { type: unknown; props: Record<string, any> }[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const render = (phase: string, dismissed = false) => { f.state = { phase, dismissed }; return elements(AppUpdateNotice()); };
const texts = (nodes: ReturnType<typeof elements>) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join("")).join("\n");
const button = (nodes: ReturnType<typeof elements>, label: string) => nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label);
afterEach(() => { vi.clearAllMocks(); });

it("shows nothing without an update or after it was dismissed", () => {
 expect(AppUpdateNotice()).toBeNull();
 f.state = { phase: "available", dismissed: true };
 expect(AppUpdateNotice()).toBeNull();
});

it("offers «Actualizar» and a way to dismiss, both thumb-sized", () => {
 const nodes = render("available");
 expect(texts(nodes)).toContain("Hay una versión nueva de Mars-RAM");
 const update = button(nodes, es.appUpdate.update)!;
 const dismiss = button(nodes, es.appUpdate.dismiss)!;
 for (const control of [update, dismiss]) expect(control.props.style.minHeight).toBeGreaterThanOrEqual(48);
 update.props.onPress(); dismiss.props.onPress();
 expect(f.update).toHaveBeenCalledOnce(); expect(f.dismiss).toHaveBeenCalledOnce();
});

it("shows the download honestly, without a second update button", () => {
 const nodes = render("downloading");
 expect(texts(nodes)).toContain(es.appUpdate.downloading);
 expect(button(nodes, es.appUpdate.update)).toBeUndefined();
 expect(button(nodes, es.appUpdate.restart)).toBeUndefined();
});

it("after a failed download says so briefly and offers «Actualizar» again", () => {
 f.state = { phase: "available", dismissed: false, failed: true } as typeof f.state;
 const nodes = elements(AppUpdateNotice());
 expect(texts(nodes)).toContain(es.appUpdate.failed);
 expect(button(nodes, es.appUpdate.update)).toBeDefined();
 expect(texts(render("available"))).not.toContain(es.appUpdate.failed);
});

it("offers «Reiniciar para actualizar» once downloaded", () => {
 const nodes = render("downloaded");
 expect(texts(nodes)).toContain(es.appUpdate.downloaded);
 const restart = button(nodes, es.appUpdate.restart)!;
 expect(restart.props.style.minHeight).toBeGreaterThanOrEqual(48);
 restart.props.onPress();
 expect(f.restart).toHaveBeenCalledOnce();
});

it("is wired into Inicio and Ajustes → Acerca de, checks once at start, in both languages", () => {
 for (const file of ["../src/app/(tabs)/index.tsx", "../src/app/(tabs)/settings.tsx"]) expect(readFileSync(new URL(file, import.meta.url), "utf8")).toContain("<AppUpdateNotice");
 expect(readFileSync(new URL("../src/app/_layout.tsx", import.meta.url), "utf8")).toContain("appUpdates.start()");
 expect(es.appUpdate).toMatchObject({ available: "Hay una versión nueva de Mars-RAM", update: "Actualizar", restart: "Reiniciar para actualizar" });
 expect(Object.keys(en.appUpdate).sort()).toEqual(Object.keys(es.appUpdate).sort());
 for (const value of Object.values(en.appUpdate)) expect(value.length).toBeGreaterThan(0);
});
