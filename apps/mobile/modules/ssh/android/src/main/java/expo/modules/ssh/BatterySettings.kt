package expo.modules.ssh

internal data class BatterySettingsTarget(val action: String, val uri: String?)

/** Try the app's own page first; never request a direct battery-optimization exemption. */
internal fun launchBatterySettings(packageName: String, launch: (BatterySettingsTarget) -> Boolean): Boolean = listOf(
  BatterySettingsTarget("android.settings.APPLICATION_DETAILS_SETTINGS", "package:$packageName"),
  BatterySettingsTarget("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS", null),
).any { runCatching { launch(it) }.getOrDefault(false) }
