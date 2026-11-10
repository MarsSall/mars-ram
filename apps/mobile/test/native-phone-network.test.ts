import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("../modules/ssh/src/SshModule", () => ({ default: {} }));
import { createPhoneNetwork, parsePhoneNetworkState, UNKNOWN_PHONE_NETWORK } from "../src/adapters/native-phone-network";

function native(state: () => Promise<unknown>) {
	return {
		phoneNetworkState: vi.fn(state),
		installTailscale: vi.fn(async () => {}),
		openTailscale: vi.fn(async () => {}),
		installZeroTier: vi.fn(async () => {}),
		openZeroTier: vi.fn(async () => {}),
		openPrivateDnsSettings: vi.fn(async () => {}),
	};
}

describe("native phone network adapter", () => {
	it("passes the native answer through", async () => {
		const network = createPhoneNetwork(native(async () => ({ tailscaleInstalled: false, tailscaleOn: false, privateDnsActive: true })));
		expect(await network.read()).toEqual({ tailscaleInstalled: false, tailscaleOn: false, privateDnsActive: true });
	});

	it("reads a missing Private DNS answer (Android < 9) as unknown", async () => {
		const network = createPhoneNetwork(native(async () => ({ tailscaleInstalled: true, tailscaleOn: false })));
		expect(await network.read()).toEqual({ tailscaleInstalled: true, tailscaleOn: false, privateDnsActive: null });
	});

	it("passes the ZeroTier facts through and leaves them out when the phone gave none", async () => {
		const network = createPhoneNetwork(native(async () => ({ tailscaleInstalled: true, tailscaleOn: false, privateDnsActive: false, zerotierInstalled: true, vpnOn: true })));
		expect(await network.read()).toEqual({ tailscaleInstalled: true, tailscaleOn: false, privateDnsActive: false, zerotierInstalled: true, vpnOn: true });
		const partial = parsePhoneNetworkState({ tailscaleInstalled: true, tailscaleOn: false, zerotierInstalled: "yes", vpnOn: 1 });
		expect(partial).toEqual({ tailscaleInstalled: true, tailscaleOn: false, privateDnsActive: null });
		expect("zerotierInstalled" in partial || "vpnOn" in partial).toBe(false);
		expect("vpnOn" in UNKNOWN_PHONE_NETWORK).toBe(false);
	});

	it("opens ZeroTier's store page and app best-effort", async () => {
		const calls = native(async () => ({}));
		calls.openZeroTier.mockRejectedValueOnce(new Error("STORE_UNAVAILABLE"));
		const network = createPhoneNetwork(calls);
		await expect(network.openZeroTier()).resolves.toBeUndefined();
		await network.installZeroTier();
		expect(calls.openZeroTier).toHaveBeenCalledTimes(1);
		expect(calls.installZeroTier).toHaveBeenCalledTimes(1);
		await expect(createPhoneNetwork(null).installZeroTier()).resolves.toBeUndefined();
	});

	it("never blocks the user on malformed native values", () => {
		for (const raw of [null, undefined, "yes", 1, []]) expect(parsePhoneNetworkState(raw)).toEqual(UNKNOWN_PHONE_NETWORK);
		expect(parsePhoneNetworkState({ tailscaleInstalled: "false", tailscaleOn: 0, privateDnsActive: "true" }))
			.toEqual({ tailscaleInstalled: true, tailscaleOn: true, privateDnsActive: null });
		expect(UNKNOWN_PHONE_NETWORK).toEqual({ tailscaleInstalled: true, tailscaleOn: true, privateDnsActive: null });
	});

	it("a failing native check reports the non-blocking state", async () => {
		const network = createPhoneNetwork(native(async () => { throw new Error("boom"); }));
		expect(await network.read()).toEqual(UNKNOWN_PHONE_NETWORK);
	});

	it("opens screens best-effort, never rejecting", async () => {
		const calls = native(async () => ({}));
		calls.openTailscale.mockRejectedValueOnce(new Error("STORE_UNAVAILABLE"));
		const network = createPhoneNetwork(calls);
		await expect(network.openTailscale()).resolves.toBeUndefined();
		await network.installTailscale();
		await network.openPrivateDnsSettings();
		expect(calls.openTailscale).toHaveBeenCalledTimes(1);
		expect(calls.installTailscale).toHaveBeenCalledTimes(1);
		expect(calls.openPrivateDnsSettings).toHaveBeenCalledTimes(1);
	});

	it("without the native module (not Android) reads the non-blocking state and opens nothing", async () => {
		const network = createPhoneNetwork(null);
		expect(await network.read()).toEqual(UNKNOWN_PHONE_NETWORK);
		await expect(network.openPrivateDnsSettings()).resolves.toBeUndefined();
	});
});
