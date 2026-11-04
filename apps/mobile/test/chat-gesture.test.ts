import { describe, expect, it } from "vitest";
import { chatGesture } from "../src/core/chat-gesture";

describe("chat handle decisions", () => {
 it.each([
  ["closed", -12, 0, "closed"],
  ["closed", -48, 0, "floating"],
  ["closed", -143, 0, "floating"],
  ["closed", -144, 0, "full"],
  ["closed", -20, -0.8, "full"],
  ["closed", -2, -2, "closed"],
  ["closed", 60, 1, "closed"],
  ["closed", -20, 1, "closed"],
  ["floating", -12, 0, "floating"],
  ["floating", -48, 0, "full"],
  ["floating", -20, -1, "full"],
  ["floating", 47, 0, "floating"],
  ["floating", 48, 0, "closed"],
 ] as const)("%s, dy=%s velocity=%s → %s", (state, dy, velocity, next) => {
  expect(chatGesture({ state, dy, velocity })).toBe(next);
 });
 it("opens floating chat on an explicit tap, not on a stationary drag", () => {
  expect(chatGesture({ state: "closed", dy: 0, velocity: 0, tap: true })).toBe("floating");
  expect(chatGesture({ state: "closed", dy: 0, velocity: 0 })).toBe("closed");
 });
 it("offers a tap alternative to expanding the floating chat", () => {
  expect(chatGesture({ state: "floating", dy: 0, velocity: 0, tap: true })).toBe("full");
 });
});
