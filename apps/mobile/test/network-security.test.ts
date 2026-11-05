import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { networkSecurityXml } = require("../plugins/with-loopback-network-security.js") as { networkSecurityXml: string };

const domains = (xml: string) => [...xml.matchAll(/<domain includeSubdomains="(true|false)">([^<]*)<\/domain>/g)].map((m) => ({ name: m[2], includeSubdomains: m[1] === "true" }));

describe("network security config", () => {
	it("blocks cleartext by default", () => {
		expect(networkSecurityXml).toContain('<base-config cleartextTrafficPermitted="false" />');
	});

	it("permits cleartext only to loopback and MagicDNS names under ts.net", () => {
		expect(domains(networkSecurityXml)).toEqual([
			{ name: "127.0.0.1", includeSubdomains: false },
			{ name: "localhost", includeSubdomains: false },
			{ name: "ts.net", includeSubdomains: true },
		]);
		expect(networkSecurityXml.match(/<domain[ >]/g)).toHaveLength(3);
		expect(networkSecurityXml.match(/<domain-config cleartextTrafficPermitted="true">/g)).toHaveLength(2);
		expect(networkSecurityXml).not.toMatch(/cleartextTrafficPermitted="true"\s*\/>/);
		expect(networkSecurityXml).not.toContain("trust-anchors");
	});
});
