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

export default ({ config }: ConfigContext): ExpoConfig =>
	withVariant(config as ExpoConfig, process.env.APP_VARIANT);
