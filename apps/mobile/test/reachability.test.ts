import { describe, expect, it } from "vitest";
import { checkReachability } from "../src/core/reachability";
import type { SavedHost } from "../src/core/host-catalog";

const host: SavedHost = {
	id: "h",
	name: "devbox",
	address: "100.64.0.10",
	dnsName: "devbox.example-tailnet.ts.net",
	sshPort: 22,
	user: "mars",
	hostKey: `SHA256:${"B".repeat(43)}`,
	addedAt: 1,
};

describe("checkReachability", () => {
	it("is reachable when the SSH server answers on the name", async () => {
		const probed: string[] = [];
		const result = await checkReachability(async (address) => {
			probed.push(address);
			return true;
		}, host);
		expect(result).toBe("reachable");
		expect(probed).toEqual(["devbox.example-tailnet.ts.net"]);
	});

	it("tries the address when the name does not answer", async () => {
		const probed: string[] = [];
		const result = await checkReachability(async (address) => {
			probed.push(address);
			return address === "100.64.0.10";
		}, host);
		expect(result).toBe("reachable");
		expect(probed).toEqual(["devbox.example-tailnet.ts.net", "100.64.0.10"]);
	});

	it("is unreachable when neither answers", async () => {
		expect(await checkReachability(async () => false, host)).toBe("unreachable");
	});
});
