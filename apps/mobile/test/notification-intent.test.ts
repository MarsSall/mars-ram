import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirectSystemPath } from "../src/app/+native-intent";
const ports = vi.hoisted(() => ({ hosts: vi.fn(), list: vi.fn() }));
vi.mock("../src/services", () => ({ catalog: { list: ports.hosts }, sessions: { list: ports.list } }));
const link = "mars-ram-preview://notice?h=00700063&b=0073&encoding=utf16-hex";
beforeEach(() => { vi.clearAllMocks(); ports.hosts.mockResolvedValue([{ id: "pc" }]); ports.list.mockResolvedValue({ computers: [{ sessions: [{ hostId: "pc", bridgeInstanceId: "s", key: "pc/s" }] }] }); });
describe("cold and warm notification intents", () => {
 it.each([true, false])("resolves confirmed session with initial=%s", async initial => {
  expect(await redirectSystemPath({ path: link, initial })).toBe("/session/open/pc%2Fs");
 });
 it("unknown host never starts discovery; ended sessions land on Inicio", async () => {
  ports.hosts.mockResolvedValueOnce([]);
  expect(await redirectSystemPath({ path: link, initial: true })).toBe("/"); expect(ports.list).not.toHaveBeenCalled();
  ports.list.mockResolvedValueOnce({ computers: [] });
  expect(await redirectSystemPath({ path: link, initial: false })).toBe("/");
 });
 it("malformed notification links never import/use host discovery", async () => {
  expect(await redirectSystemPath({ path: link + "&command=evil", initial: true })).toBe("/");
  expect(ports.hosts).not.toHaveBeenCalled(); expect(ports.list).not.toHaveBeenCalled();
 });
});
