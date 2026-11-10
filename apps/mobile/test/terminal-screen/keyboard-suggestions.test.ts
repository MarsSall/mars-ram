import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const marker = "MarsRamTerminal";

describe("terminal keyboard without suggestions", () => {
 it("opts only the terminal WebView into the no-suggestions keyboard", () => {
  expect(read("../../src/app/session/terminal/[id].tsx")).toContain(`applicationNameForUserAgent="${marker}"`);
  const viewer = read("../../src/ui/server-viewer.tsx");
  expect(viewer).not.toContain(marker);
  expect(viewer).not.toContain("applicationNameForUserAgent");
 });
 it("registers the react-native-webview patch that reads the marker", () => {
  expect(read("../../../../pnpm-workspace.yaml")).toContain("react-native-webview@14.0.1: patches/react-native-webview@14.0.1.patch");
  const patch = read("../../../../patches/react-native-webview@14.0.1.patch");
  expect(patch).toContain(`applicationName?.contains("${marker}") == true`);
  expect(patch).toContain("TYPE_TEXT_VARIATION_VISIBLE_PASSWORD");
  expect(patch).toContain("TYPE_TEXT_FLAG_NO_SUGGESTIONS");
 });
});
