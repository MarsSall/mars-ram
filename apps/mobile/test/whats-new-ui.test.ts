import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { en } from "../src/ui/i18n/en";
import { es } from "../src/ui/i18n/es";
import { WhatsNewView } from "../src/ui/whats-new";
import type { ReleaseNote } from "../src/core/whats-new";

vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", Modal: "Modal" }));
vi.mock("../src/services", () => ({ whatsNew: { pending: vi.fn(), dismiss: vi.fn() } }));
vi.mock("../src/ui/components", () => ({ PrimaryButton: "PrimaryButton", EmptyState: "EmptyState", Screen: "Screen" }));
vi.mock("../src/ui/preferences", () => ({ usePreferences: vi.fn() }));
const theme = { touch: 48, spacing: (n: number) => n * 4, radius: { medium: 12 }, colors: { text: "white", textMuted: "gray", accentText: "green", background: "black", card: "card" } };

function elements(node: unknown): { type: unknown; props: Record<string, any> }[] {
 if (Array.isArray(node)) return node.flatMap(elements);
 if (!isValidElement<Record<string, any>>(node)) return [];
 return [{ type: node.type, props: node.props }, ...elements(node.props.footer), ...elements(node.props.children)];
}
const texts = (nodes: ReturnType<typeof elements>) => nodes.filter(n => n.type === "Text").map(n => [n.props.children].flat().join(""));
const note: ReleaseNote = { build: 8, version: "1.0.0", es: { new: ["Algo nuevo"], fixes: ["Algo arreglado"] }, en: { new: ["Something new"], fixes: ["Something fixed"] } };

it("shows the title, version and the «Nuevo» and «Arreglos» lists in the app's language", () => {
 const onClose = vi.fn();
 const nodes = elements(WhatsNewView({ notes: [note], locale: "es", t: es, theme: theme as never, onClose }));
 const shown = texts(nodes);
 expect(nodes.find(n => n.type === "Screen")?.props.title).toBe("Novedades");
 expect(shown).toContain(es.whatsNew.version("1.0.0", 8));
 expect(shown).toContain("Nuevo"); expect(shown).toContain("Arreglos");
 expect(shown.some(line => line.includes("Algo nuevo"))).toBe(true);
 expect(shown.some(line => line.includes("Algo arreglado"))).toBe(true);
 expect(shown.some(line => line.includes("Something"))).toBe(false);
 const done = nodes.find(n => n.type === "PrimaryButton")!;
 expect(done.props.label).toBe("Entendido");
 done.props.onPress();
 expect(onClose).toHaveBeenCalledOnce();
});

it("omits an empty list and explains when there are no notes", () => {
 const onlyNew = { ...note, en: { new: ["Something new"], fixes: [] } };
 expect(texts(elements(WhatsNewView({ notes: [onlyNew], locale: "en", t: en, theme: theme as never, onClose: () => {} })))).not.toContain(en.whatsNew.fixes);
 const empty = elements(WhatsNewView({ notes: [], locale: "en", t: en, theme: theme as never, onClose: () => {} }));
 expect(empty.find(n => n.type === "EmptyState")?.props.message).toBe(en.whatsNew.empty);
});

it("opens once after an update from the root and stays reachable from Ajustes → Acerca de", () => {
 const layout = readFileSync(new URL("../src/app/_layout.tsx", import.meta.url), "utf8");
 expect(layout).toContain("<WhatsNewGate");
 const settings = readFileSync(new URL("../src/app/(tabs)/settings.tsx", import.meta.url), "utf8");
 expect(settings).toContain("t.whatsNew.open");
 expect(settings).toContain('"/whats-new"');
 // «Compilación» shows the same build «Novedades» uses, not Expo's empty value.
 expect(settings).toContain("appBuild.build");
 expect(settings).not.toContain("Constants.nativeBuildVersion");
 expect(readFileSync(new URL("../src/app/whats-new.tsx", import.meta.url), "utf8")).toContain("whatsNew.all()");
 expect(es.whatsNew).toMatchObject({ title: "Novedades", new: "Nuevo", fixes: "Arreglos", done: "Entendido", open: "Novedades" });
 expect(Object.keys(en.whatsNew).sort()).toEqual(Object.keys(es.whatsNew).sort());
});
