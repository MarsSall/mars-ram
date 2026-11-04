// Shared design tokens, including the terminal palette.
export type ThemeName = "verde-profundo" | "oro-y-verde";
export function resolveThemeName(value: unknown): ThemeName {
 return value === "oro-y-verde" || value === "verde-profundo" ? value : "verde-profundo";
}
export type Theme = {
 name: ThemeName;
 colors: { fileModified: string; fileDeleted: string; fileUncommitted: string; fileLastCommit: string; background: string; surface: string; surfaceRaised: string; border: string; text: string; textMuted: string; accent: string; /** Accent for text, links and icons on dark surfaces (accent itself is a fill). */ accentText: string; /** Active tab label. */ tabActive: string; /** Active tab icon: darker than the label, still ≥ 3:1. */ tabActiveIcon: string; /** Translucent card fill so the glow shows through. */ card: string; onAccent: string; attention: string; working: string; done: string; danger: string; terminalBackground: string; terminalText: string };
 primaryFill: { backgroundImage?: string; shadowColor?: string };
 spacing: (steps: number) => number;
 radius: { small: number; medium: number; large: number };
 font: { mono: string };
 touch: number;
};
const shared = {
 spacing: (steps: number) => steps * 4,
 radius: { small: 6, medium: 10, large: 16 },
 font: { mono: "monospace" }, touch: 48,
};
// Keep every palette-specific color together for palette revisions.
const verdeProfundo = {
 colors: { fileModified: "#E0AF68", fileDeleted: "#F7768E", fileUncommitted: "#9ECE6A", fileLastCommit: "#7DCFFF", background: "#010101", surface: "#060A08", surfaceRaised: "#101A14", border: "#1F3328", text: "#F6EFF3", textMuted: "#C1C9C1", accent: "#0A4F31", accentText: "#5CCB94", tabActive: "#1F8A5B", tabActiveIcon: "#0F6B43", card: "rgba(6, 12, 9, 0.55)", onAccent: "#FFFFFF", attention: "#E0C27A", working: "#B4E7C7", done: "#B4E7C7", danger: "#F7768E", terminalBackground: "#010101", terminalText: "#F6EFF3" },
 primaryFill: { shadowColor: "#126E46" },
};
const oroYVerde = {
 colors: { fileModified: "#E0AF68", fileDeleted: "#F7768E", fileUncommitted: "#9ECE6A", fileLastCommit: "#7DCFFF", background: "#010101", surface: "#0A0A08", surfaceRaised: "#17150F", border: "#2A2213", text: "#F3E9D2", textMuted: "#B9AC8F", accent: "#B38A33", accentText: "#D9B45F", tabActive: "#D9B45F", tabActiveIcon: "#B38A33", card: "rgba(10, 10, 8, 0.55)", onAccent: "#0A0703", attention: "#E0C27A", working: "#7FD3A6", done: "#7FD3A6", danger: "#F7768E", terminalBackground: "#010101", terminalText: "#F3E9D2" },
 // Burnished gold: light top, dark lower edge.
 primaryFill: { backgroundImage: "linear-gradient(180deg, #F2D88E 0%, #D9B45F 30%, #B38A33 62%, #A07A2C 100%)" },
};
export const themes: Record<ThemeName, Theme> = {
 "verde-profundo": { ...shared, ...verdeProfundo, name: "verde-profundo" },
 "oro-y-verde": { ...shared, ...oroYVerde, name: "oro-y-verde" },
};
