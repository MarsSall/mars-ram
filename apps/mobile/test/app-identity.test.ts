import { expect, it } from "vitest";
import manifest from "../app.json";

it("uses the Mars-RAM name and identity", () => {
	expect({
		name: manifest.expo.name,
		slug: manifest.expo.slug,
		scheme: manifest.expo.scheme,
		androidPackage: manifest.expo.android.package,
	}).toEqual({
		name: "Mars-RAM",
		slug: "mars-ram",
		scheme: "mars-ram",
		androidPackage: "com.marssall.marsram",
	});
});

it("keeps R8 minification off in release builds", () => {
	// R8 broke the QR scanner in the first release build (camera showed, no code was ever detected);
	// sshj/BouncyCastle and whisper.rn also rely on reflection that R8 can strip.
	const plugin = manifest.expo.plugins.find(entry => Array.isArray(entry) && entry[0] === "expo-build-properties") as [string, { android?: { enableMinifyInReleaseBuilds?: boolean } }] | undefined;
	expect(plugin?.[1].android?.enableMinifyInReleaseBuilds).toBe(false);
});

it("blocks the overlay permission the Expo template adds for the dev menu", () => {
	// SYSTEM_ALERT_WINDOW (draw over other apps) is only for development and is a sensitive permission on Play.
	expect(manifest.expo.android.blockedPermissions).toContain("android.permission.SYSTEM_ALERT_WINDOW");
});
