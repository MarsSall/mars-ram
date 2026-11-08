import { expect, it } from "vitest";
import manifest from "../app.json";
import eas from "../eas.json";
import { withVariant } from "../app.config";

const base = manifest.expo;

function identity(config: ReturnType<typeof withVariant>) {
	return {
		name: config.name,
		scheme: config.scheme,
		androidPackage: config.android?.package,
	};
}

it("keeps the store identity when no variant is set", () => {
	const config = withVariant(base, undefined);

	expect(identity(config)).toEqual({
		name: "Mars-RAM",
		scheme: "mars-ram",
		androidPackage: "com.marssall.marsram",
	});
	expect(config).toEqual(base);
});

it("gives the preview variant its own name, package and scheme", () => {
	const config = withVariant(base, "preview");

	expect(identity(config)).toEqual({
		name: "Mars-RAM Prueba",
		scheme: "mars-ram-preview",
		androidPackage: "com.marssall.marsram.preview",
	});
	expect(config.icon).toBe(base.icon);
	expect(config.plugins).toEqual(base.plugins);
	expect(config.android?.adaptiveIcon).toEqual(base.android.adaptiveIcon);
});

it("refuses an unknown variant", () => {
	expect(() => withVariant(base, "staging")).toThrow(
		'Unknown APP_VARIANT "staging"; use "preview" or leave it unset.',
	);
});

it("builds the store bundle without a variant and the preview APK with one", () => {
	const { development, preview, production } = eas.build;

	expect(production.android.buildType).toBe("app-bundle");
	expect(production.autoIncrement).toBe(true);
	expect("env" in production).toBe(false);
	expect(preview.env.APP_VARIANT).toBe("preview");
	expect(preview.android.buildType).toBe("apk");
	expect(development.developmentClient).toBe(true);
	expect(eas.cli.appVersionSource).toBe("remote");
});

it("submits to the internal track, published for testers only", () => {
	// Internal testing reaches only the testers' list; production stays a manual decision.
	expect(eas.submit.production.android).toEqual({ track: "internal", releaseStatus: "completed" });
});

it("has a closed-testing submit profile on the alpha track", () => {
	// Play requires a closed test with testers before production. Until the app is published,
	// Play only accepts draft releases there; the owner sends them to review in the console.
	expect(eas.submit.closed.android).toEqual({ track: "alpha", releaseStatus: "draft" });
});
