import Constants from "expo-constants";
import { Platform } from "react-native";
import Ssh from "../../modules/ssh/src/SshModule";
import type { AppUpdateSource } from "../core/app-updates";
import { currentAppBuild, type AppBuild } from "../core/whats-new";

const android = Platform.OS === "android";

/** Google Play In-App Updates through the native module; never throws. */
export const playAppUpdates: AppUpdateSource = {
 check: async () => android ? Ssh.checkAppUpdate().catch(() => ({ available: false })) : { available: false },
 start: async () => android ? Ssh.startFlexibleUpdate().catch(() => ({ started: false, downloaded: false })) : { started: false, downloaded: false },
 complete: async () => { if (android) await Ssh.completeUpdate().catch(() => {}); },
 progress: async () => android ? Ssh.appUpdateProgress().catch(() => "none" as const) : "none",
 onInstallEvent: listener => {
  if (!android) return () => {};
  const subscription = Ssh.addListener("onAppUpdateStatus", ({ status }) => listener(status));
  return () => subscription.remove();
 },
};

/** The installed versionCode from PackageManager; Expo's values only as fallback
 * (its native build number can be empty on release builds). */
export function readAppBuild(): AppBuild {
 let native = null;
 try { native = android ? Ssh.appBuild() : null; } catch { native = null; }
 const expo = Constants as unknown as { nativeBuildVersion?: string | null; nativeApplicationVersion?: string | null; nativeAppVersion?: string | null };
 const manifestCode = Constants.platform?.android?.versionCode;
 return currentAppBuild(native, {
  nativeBuildVersion: expo.nativeBuildVersion ?? (manifestCode ? String(manifestCode) : null),
  nativeApplicationVersion: expo.nativeApplicationVersion ?? expo.nativeAppVersion ?? Constants.expoConfig?.version ?? null,
 });
}
