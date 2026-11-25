import { Platform } from "react-native";
import Ssh from "../../modules/ssh/src/SshModule";
import type { SystemGestureInsets } from "../core/key-bar-visibility";

type NativeCalls = { systemGestureInsets(): Promise<unknown> };
export type SystemGestureInsetsSource = { read(): Promise<SystemGestureInsets | null> };

const dp = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** Only real, non-negative dp numbers count; anything else is unavailable and the core uses its fallback. */
export function parseSystemGestureInsets(raw: unknown): SystemGestureInsets | null {
	if (typeof raw !== "object" || raw === null) return null;
	const value = raw as Record<string, unknown>;
	if (!dp(value.mandatoryBottom) || !dp(value.navigationBottom)) return null;
	return { mandatoryBottom: value.mandatoryBottom as number, navigationBottom: value.navigationBottom as number };
}

/** Android's bottom gesture zone, read from the activity's root insets (key-bar-autohide S5). Never rejects:
 * off Android, before Android 10, without an activity or on an older build without the call, it is null. */
export function createSystemGestureInsets(native: NativeCalls | null): SystemGestureInsetsSource {
	return {
		read: async () => {
			if (!native) return null;
			try { return parseSystemGestureInsets(await native.systemGestureInsets()); } catch { return null; }
		},
	};
}

export const nativeSystemGestureInsets = createSystemGestureInsets(Platform.OS === "android" ? Ssh : null);
