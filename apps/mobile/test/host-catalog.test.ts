import { describe, expect, it } from "vitest";
import { parseSavedHosts, type SavedHost } from "../src/core/host-catalog";

const host: SavedHost = {
	id: "h1",
	keyAlias: "app-ssh-key",
	rotation: { phase: "done" },
	name: "devbox",
	address: "100.64.0.10",
	dnsName: "devbox.example-tailnet.ts.net",
	sshPort: 22,
	user: "mars",
	hostKey: `SHA256:${"B".repeat(43)}`,
	addedAt: 1,
};

describe("parseSavedHosts", () => {
	it("reads the saved computers", () => {
		expect(parseSavedHosts(JSON.stringify({ version: 1, hosts: [host] }))).toEqual({ hosts: [host], dropped: 0 });
	});

	it("starts empty when nothing was saved yet", () => {
		expect(parseSavedHosts(null)).toEqual({ hosts: [], dropped: 0 });
	});

	it("starts empty instead of crashing when the file is damaged", () => {
		expect(parseSavedHosts("{not json")).toEqual({ hosts: [], dropped: 0 });
	});

	it("drops entries that are not valid computers and says how many", () => {
		const broken = { ...host, id: "h2", hostKey: "MD5:aa" };
		expect(parseSavedHosts(JSON.stringify({ version: 1, hosts: [host, broken, "x"] }))).toEqual({ hosts: [host], dropped: 2 });
	});
});
