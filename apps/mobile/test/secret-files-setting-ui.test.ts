import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { SecretFilesSetting } from "../src/ui/secret-files-setting";
import { es } from "../src/ui/i18n/es";

const f = vi.hoisted(() => ({ hide: true, failed: false, set: vi.fn(async (_value: boolean) => {}), writes: [] as unknown[] }));
vi.mock("react", async importOriginal => ({
 ...await importOriginal<typeof import("react")>(),
 useState: () => [f.failed, (next: unknown) => f.writes.push(next)],
 useSyncExternalStore: () => f.hide,
}));
vi.mock("react-native", () => ({ Switch: "Switch", Text: "Text", View: "View" }));
vi.mock("../src/services", () => ({ secretFiles: { subscribe: vi.fn(), get: () => f.hide, set: f.set } }));
vi.mock("../src/ui/preferences", async () => { const { es: t } = await import("../src/ui/i18n/es"); return { usePreferences: () => ({ t, theme: { colors: {}, spacing: (n: number) => n * 4, touch: 48 } }) }; });
vi.mock("../src/ui/components", () => ({ Card: "Card", SectionTitle: "SectionTitle" }));
function elements(node: unknown): { type: unknown; props: Record<string, any> }[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const s = es.secretFiles;
const render = (hide: boolean, failed = false) => { f.hide = hide; f.failed = failed; return elements(SecretFilesSetting()); };
const text = (nodes: ReturnType<typeof render>) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join("")).join("\n");
const toggle = (nodes: ReturnType<typeof render>) => nodes.find(n => n.type === "Switch")!;
afterEach(() => { f.hide = true; f.failed = false; f.writes.length = 0; vi.clearAllMocks(); });

describe("Settings › Project browser › hide secret files", () => {
 it("shows its own section, a labelled switch, and the hint", () => {
  const nodes = render(true);
  expect(nodes.find(n => n.type === "SectionTitle")?.props.children).toBe("Explorador del proyecto");
  expect(text(nodes)).toContain("Ocultar archivos secretos");
  expect(text(nodes)).toContain("Los archivos .env, claves privadas y credenciales no aparecen en el explorador del proyecto hasta que tocás Mostrar.");
  expect(toggle(nodes).props.accessibilityLabel).toBe(s.label);
  expect(nodes.some(n => n.type === "View" && n.props.style?.minHeight >= 48)).toBe(true);
 });
 it("reflects the stored value", () => {
  expect(toggle(render(true)).props.value).toBe(true);
  expect(toggle(render(false)).props.value).toBe(false);
 });
 it("saves the new value when toggled", () => {
  toggle(render(true)).props.onValueChange(false); expect(f.set).toHaveBeenLastCalledWith(false);
  toggle(render(false)).props.onValueChange(true); expect(f.set).toHaveBeenLastCalledWith(true);
 });
 it("says so when the setting could not be saved", async () => {
  f.set.mockRejectedValueOnce(new Error("disk full"));
  toggle(render(true)).props.onValueChange(false); await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.writes).toContain(true);
  const nodes = render(true, true);
  const alert = nodes.find(n => n.props.accessibilityRole === "alert");
  expect([alert?.props.children].flat().join("")).toBe("No se pudo guardar el ajuste.");
  expect(text(render(true, false))).not.toContain("No se pudo guardar el ajuste.");
 });
});
