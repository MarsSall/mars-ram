import { describe, expect, it } from "vitest";
import { terminalLauncherOptions } from "../src/core/terminal-launcher";

describe("terminal launcher options", () => {
 it("offers the standalone terminal as the only enabled default", () => {
  expect(terminalLauncherOptions.filter(option => option.enabled)).toEqual([
   { id: "standalone", name: "Herdr", enabled: true, default: true },
  ]);
 });
 it("keeps future support informational, not launchable", () => {
  expect(terminalLauncherOptions.find(option => option.id === "future")).toEqual({ id: "future", enabled: false, default: false });
  expect(terminalLauncherOptions.filter(option => option.default)).toHaveLength(1);
 });
});
