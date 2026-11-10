import { AppState, Linking, PermissionsAndroid, Platform } from "react-native";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import Ssh from "../../modules/ssh/src/SshModule";
import type { AlwaysRegistration, NotificationMode } from "../core/notifications";
import { readDurable, writeDurable } from "./durable-file";
const file = () => new File(Paths.document, "notification-mode.json");
/** Host ids, fingerprints, networks and addresses only; the notice secrets stay in the native encrypted vault. */
const registrationsFile = () => new File(Paths.document, "notification-registrations.json");
export const nativeNotifications = {
 read: (): unknown => { try { const f = file(); return f.exists ? JSON.parse(f.textSync()) : "off"; } catch { return "off"; } },
 write: async (mode: NotificationMode) => { const f = file(); if (!f.exists) f.create(); await f.write(JSON.stringify(mode)); },
 registrations: async (): Promise<unknown> => await readDurable(registrationsFile(), JSON.parse) ?? [],
 saveRegistrations: (records: AlwaysRegistration[]) => writeDurable(registrationsFile(), JSON.stringify(records)),
 visible: () => AppState.currentState === "active",
 permission: async () => Platform.OS !== "android" || Number(Platform.Version) < 33 ||
  await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) === PermissionsAndroid.RESULTS.GRANTED,
 start: Ssh.startSessionWatch.bind(Ssh), stop: Ssh.stopSessionWatch.bind(Ssh), status: Ssh.sessionWatchStatus.bind(Ssh),
 register: Ssh.registerAlwaysNotify.bind(Ssh), forget: Ssh.forgetAlwaysNotify.bind(Ssh),
 batteryExempt: () => Ssh.isIgnoringBatteryOptimizations(),
 openBattery: () => Ssh.openBatteryOptimizationSettings(),
 language: (language: "es" | "en") => Ssh.setNotificationLanguage(language),
 openSettings: async () => {
  const appPackage = Constants.expoConfig?.android?.package;
  if (Platform.OS === "android" && appPackage) await Linking.sendIntent("android.settings.APP_NOTIFICATION_SETTINGS", [{ key: "android.provider.extra.APP_PACKAGE", value: appPackage }]);
  else await Linking.openSettings();
 },
};
