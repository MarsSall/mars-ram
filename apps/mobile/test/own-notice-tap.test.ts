// release-0.1.8 S5 / L6: «Que las notificaciones propias no pregunten». Only a notice link carrying the
// install's secret tap mark (checked natively) skips the confirmation; anything else asks first.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirectSystemPath } from "../src/app/+native-intent";
import { decodeNotificationLink } from "../src/core/notification-routing";

const ports = vi.hoisted(() => ({ hosts: vi.fn(), list: vi.fn(), accepts: vi.fn() }));
vi.mock("../src/services", () => ({ catalog: { list: ports.hosts }, sessions: { list: ports.list }, noticeTaps: { accepts: ports.accepts } }));

const mark = "0123456789abcdef".repeat(4);
const base = "mars-ram-preview://notice?h=00700063&b=0073&encoding=utf16-hex";
const own = `${base}&t=${mark}`;
const confirm = "/link-terminal?h=00700063&b=0073";
beforeEach(() => {
	vi.resetAllMocks();
	ports.hosts.mockResolvedValue([{ id: "pc", name: "devbox" }]);
	ports.list.mockResolvedValue({ computers: [{ sessions: [{ hostId: "pc", bridgeInstanceId: "s", key: "pc/s" }] }] });
	ports.accepts.mockResolvedValue(true);
});

describe("the app's own notification taps open directly", () => {
	it.each([true, false])("an accepted mark goes to the session as before (initial=%s)", async initial => {
		expect(await redirectSystemPath({ path: own, initial })).toBe("/session/open/pc%2Fs");
		expect(ports.accepts).toHaveBeenCalledWith(mark);
		expect(ports.list).toHaveBeenCalledOnce();
	});

	it("an accepted mark for a computer that is not saved still never starts discovery", async () => {
		ports.hosts.mockResolvedValueOnce([]);
		expect(await redirectSystemPath({ path: own, initial: true })).toBe("/");
		expect(ports.list).not.toHaveBeenCalled();
	});

	it("an accepted mark for an ended session lands on Inicio", async () => {
		ports.list.mockResolvedValueOnce({ computers: [] });
		expect(await redirectSystemPath({ path: own, initial: false })).toBe("/");
	});
});

describe("everything else asks first, without the mark in the route", () => {
	it("no mark: confirmation, and the native check is not even asked", async () => {
		expect(await redirectSystemPath({ path: base, initial: true })).toBe(confirm);
		expect(ports.accepts).not.toHaveBeenCalled(); expect(ports.list).not.toHaveBeenCalled();
	});

	it.each([
		["refused", () => ports.accepts.mockResolvedValueOnce(false)],
		["not a boolean", () => ports.accepts.mockResolvedValueOnce("true")],
		["rejected", () => ports.accepts.mockRejectedValueOnce(new Error("native"))],
		["thrown", () => ports.accepts.mockImplementationOnce(() => { throw new TypeError("not a function"); })],
	])("a %s check goes to the confirmation without connecting", async (_name, arrange) => {
		arrange();
		const route = await redirectSystemPath({ path: own, initial: true });
		expect(route).toBe(confirm); expect(route).not.toContain(mark);
		expect(ports.list).not.toHaveBeenCalled();
	});

	it("check unavailable (old native build) goes to the confirmation", async () => {
		const services = await import("../src/services") as unknown as { noticeTaps?: unknown };
		const saved = services.noticeTaps; delete services.noticeTaps;
		try { expect(await redirectSystemPath({ path: own, initial: true })).toBe(confirm); }
		finally { services.noticeTaps = saved; }
		expect(ports.list).not.toHaveBeenCalled();
	});

	it.each([
		`${base}&t=${mark.toUpperCase()}`, `${base}&t=${mark.slice(1)}`, `${base}&t=${mark}0`, `${base}&t=`,
		`${base}&t=${mark}&t=${mark}`, `${base}&t=${mark}&x=1`, `${base.replace("&encoding", `&t=${mark}&encoding`)}`,
		`${base}&t=${mark.slice(2)}%61%62`,
	])("the policy rejects a malformed mark or extra parameters: %s", async path => {
		expect(decodeNotificationLink(path)).toBeNull();
		expect(await redirectSystemPath({ path, initial: true })).toBe("/");
		expect(ports.accepts).not.toHaveBeenCalled(); expect(ports.list).not.toHaveBeenCalled();
	});
});
