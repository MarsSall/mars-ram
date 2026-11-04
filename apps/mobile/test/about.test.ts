import { describe, expect, it } from "vitest";
import { privacyUrl } from "../src/core/about";

describe("privacy policy URL", () => {
 it("uses the Spanish page for Spanish and the English page for English", () => {
  expect(privacyUrl("es", "en")).toBe("https://marssall.github.io/mars-ram/privacy.es");
  expect(privacyUrl("en", "es")).toBe("https://marssall.github.io/mars-ram/privacy");
 });
 it("resolves the system language like the app, falling back to English", () => {
  expect(privacyUrl("system", "es")).toBe("https://marssall.github.io/mars-ram/privacy.es");
  expect(privacyUrl("system", "fr")).toBe("https://marssall.github.io/mars-ram/privacy");
  expect(privacyUrl("system", undefined)).toBe("https://marssall.github.io/mars-ram/privacy");
 });
});
