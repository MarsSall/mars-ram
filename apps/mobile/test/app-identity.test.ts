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
