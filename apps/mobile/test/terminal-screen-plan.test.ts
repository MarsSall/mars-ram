import { describe, expect, it } from "vitest";
import { terminalScreenPlan } from "../src/core/terminal-screen-plan";

describe("terminal screen plan", () => {
 it("a session terminal binds its pane chat and keeps its channel on blur", () => {
  expect(terminalScreenPlan({ id: "one/bridge" })).toEqual({ hostId: "one", routeSessionKey: "one/bridge", shell: false, paneChat: true, routeFocus: null, closeOnBlur: false });
 });
 it("«Abrir Herdr» discovers the focused pane and honours a route focus", () => {
  expect(terminalScreenPlan({ id: "one", standalone: "1", focusWorkspace: "w1", focusTab: "w1:t2" })).toEqual({ hostId: "one", routeSessionKey: undefined, shell: false, paneChat: true, routeFocus: { workspace: "w1", tab: "w1:t2" }, closeOnBlur: false });
 });
 it("the plain shell runs no Herdr/Pi discovery, ignores route focus and closes on blur", () => {
  expect(terminalScreenPlan({ id: "one", standalone: "1", shell: "1", focusWorkspace: "w1", focusTab: "w1:t2" })).toEqual({ hostId: "one", routeSessionKey: undefined, shell: true, paneChat: false, routeFocus: null, closeOnBlur: true });
 });
 it("shell=1 only counts on a standalone terminal", () => {
  expect(terminalScreenPlan({ id: "one/bridge", shell: "1" }).shell).toBe(false);
 });
});
