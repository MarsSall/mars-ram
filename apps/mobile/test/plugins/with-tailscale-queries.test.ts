import { createRequire } from "node:module";
import { expect, it } from "vitest";
import manifest from "../../app.json";
import { withExtraPlugins } from "../../app.config";

const require = createRequire(import.meta.url);
type Entry = { $: Record<string, string> };
type Manifest = { "uses-permission"?: Entry[]; queries?: { package?: Entry[]; intent?: unknown[] }[] };
const { addTailscaleQueries } = require("../../plugins/with-tailscale-queries.js") as { addTailscaleQueries: (m: Manifest) => Manifest };

const packages = (m: Manifest) => (m.queries ?? []).flatMap(block => (block.package ?? []).map(entry => entry.$["android:name"]));
const permissions = (m: Manifest) => (m["uses-permission"] ?? []).map(entry => entry.$["android:name"]);

it("makes only the Tailscale and ZeroTier apps visible, in a new <queries> block", () => {
	const result = addTailscaleQueries({});
	expect(packages(result)).toEqual(["com.tailscale.ipn", "com.zerotier.one"]);
	expect(result.queries).toHaveLength(1);
	expect(permissions(result)).toEqual(["android.permission.ACCESS_NETWORK_STATE"]);
});

it("merges into an existing <queries> block and keeps its entries", () => {
	const intent = { action: [{ $: { "android:name": "android.intent.action.VIEW" } }] };
	const result = addTailscaleQueries({
		"uses-permission": [{ $: { "android:name": "android.permission.INTERNET" } }],
		queries: [{ intent: [intent], package: [{ $: { "android:name": "other.app" } }] }],
	});
	expect(result.queries).toHaveLength(1);
	expect(result.queries?.[0].intent).toEqual([intent]);
	expect(packages(result)).toEqual(["other.app", "com.tailscale.ipn", "com.zerotier.one"]);
	expect(permissions(result)).toEqual(["android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE"]);
});

it("is idempotent and never asks to see every package", () => {
	const twice = addTailscaleQueries(addTailscaleQueries({}));
	expect(packages(twice)).toEqual(["com.tailscale.ipn", "com.zerotier.one"]);
	expect(permissions(twice)).toEqual(["android.permission.ACCESS_NETWORK_STATE"]);
	expect(permissions(twice)).not.toContain("android.permission.QUERY_ALL_PACKAGES");
});

it("adds only the package that is missing when one is already declared", () => {
	const result = addTailscaleQueries({ queries: [{}, { package: [{ $: { "android:name": "com.zerotier.one" } }] }] });
	expect(packages(result)).toEqual(["com.tailscale.ipn", "com.zerotier.one"]);
});

it("is registered once for every variant, after app.json's plugins", () => {
	const config = withExtraPlugins(manifest.expo);
	expect(config.plugins).toEqual([...manifest.expo.plugins, "./plugins/with-tailscale-queries"]);
	expect(withExtraPlugins(config).plugins).toEqual(config.plugins);
});
