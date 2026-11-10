import type { ConfigContext, ExpoConfig } from "expo/config";

type Identity = {
	name: string;
	scheme?: string | string[];
	android?: { package?: string };
};

// The preview variant installs next to the store app and the debug dev client,
// so testing a release build never replaces them or wipes their pairing data.
export function withVariant<T extends Identity>(config: T, variant: string | undefined): T {
	if (variant === undefined || variant === "") return config;
	if (variant !== "preview") {
		throw new Error(`Unknown APP_VARIANT "${variant}"; use "preview" or leave it unset.`);
	}
	return {
		...config,
		name: `${config.name} Prueba`,
		scheme: "mars-ram-preview",
		android: { ...config.android, package: `${config.android?.package}.preview` },
	};
}

/** Config plugins added on top of app.json's list, for every variant. */
export const extraPlugins = ["./plugins/with-tailscale-queries"];

export function withExtraPlugins<T extends { plugins?: unknown[] }>(config: T): T {
	const plugins: unknown[] = config.plugins ?? [];
	return { ...config, plugins: [...plugins, ...extraPlugins.filter(name => !plugins.includes(name))] };
}

export default ({ config }: ConfigContext): ExpoConfig =>
	withExtraPlugins(withVariant(config as ExpoConfig, process.env.APP_VARIANT));
