import { describe, expect, it } from "vitest";
import { NetworkChoice, parseNetworkChoice, type NetworkChoiceStore } from "../src/core/network-choice";

function memoryStore(initial: string | null = null) {
	const writes: string[] = [];
	let value = initial;
	const store: NetworkChoiceStore = {
		read: () => value,
		write: async (text) => {
			writes.push(text);
			value = text;
		},
	};
	return { store, writes };
}

describe("the wizard's network choice", () => {
	it("defaults to Tailscale when nothing was chosen yet, and says nothing was chosen", () => {
		const choice = new NetworkChoice(memoryStore().store);
		expect(choice.current()).toBe("tailscale");
		expect(choice.saved()).toBeNull();
	});

	it("remembers the last choice across openings", async () => {
		const { store, writes } = memoryStore();
		await new NetworkChoice(store).choose("zerotier");
		expect(writes).toEqual(['"zerotier"']);
		const reopened = new NetworkChoice(store);
		expect(reopened.current()).toBe("zerotier");
		expect(reopened.saved()).toBe("zerotier");
	});

	it("reads anything unexpected as not chosen", () => {
		for (const raw of [null, "", "nope", '"wireguard"', "1", "{}"]) expect(parseNetworkChoice(raw)).toBeNull();
		expect(parseNetworkChoice('"tailscale"')).toBe("tailscale");
		expect(parseNetworkChoice('"zerotier"')).toBe("zerotier");
	});

	it("never blocks the wizard when the file cannot be read or written", async () => {
		const broken: NetworkChoiceStore = {
			read: () => {
				throw new Error("io");
			},
			write: async () => {
				throw new Error("io");
			},
		};
		const choice = new NetworkChoice(broken);
		expect(choice.current()).toBe("tailscale");
		await expect(choice.choose("zerotier")).resolves.toBeUndefined();
		// Kept for this opening even though it could not be saved.
		expect(choice.current()).toBe("zerotier");
	});
});
