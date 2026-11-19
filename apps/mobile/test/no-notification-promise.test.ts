import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { notificationCopy } from "../src/ui/notification-copy";

describe("notification honesty", () => {
 it("adds the opt-in card without removing existing settings", () => {
  const source = readFileSync(join(import.meta.dirname, "../src/app/(tabs)/settings.tsx"), "utf8");
  expect(source).toContain("<NotificationSettingsCard />");
  // Ajustes reorganized (S9): the rest lives in «Más ajustes» and the language in Personalización.
  const more = readFileSync(join(import.meta.dirname, "../src/app/more-settings.tsx"), "utf8");
  for (const existing of ["<DictationSettings />", "changeUnlock", "setRetention"]) expect(more).toContain(existing);
  expect(readFileSync(join(import.meta.dirname, "../src/app/personalization.tsx"), "utf8")).toContain("setLanguage");
  // The theme moved to Ajustes › Personalización (S16).
  expect(readFileSync(join(import.meta.dirname, "../src/app/personalization.tsx"), "utf8")).toContain("setTheme");
 });
 it("both languages disclose force-stop, idle deadlines, Tailscale, battery and passive-listener limits", () => {
  expect(notificationCopy.es.limits).toMatch(/forzar la detención/);
  expect(notificationCopy.en.limits).toMatch(/force-stop/);
  for (const t of Object.values(notificationCopy)) {
   expect(t.workingHelp).toMatch(/2 minut/); expect(t.workingHelp).toMatch(/2 hor|2 hours/);
   expect(t.alwaysHelp).toContain("Tailscale"); expect(t.alwaysHelp).toMatch(/batería|battery/);
   expect(t.alwaysHelp).toMatch(/No detecta|Cannot detect/);
  }
 });
});
