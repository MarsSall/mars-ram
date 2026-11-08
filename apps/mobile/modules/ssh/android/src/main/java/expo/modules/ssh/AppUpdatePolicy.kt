package expo.modules.ssh

import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

/** The fields of Play's AppUpdateInfo that decide the notice; null when Play could not answer. */
internal data class PlayUpdateInfo(val availability: Int, val installStatus: Int, val versionCode: Int, val flexibleAllowed: Boolean)

private val NOT_AVAILABLE: Map<String, Any> = mapOf("available" to false)

/** Never fails: no Play, non-Play installs and errors are all "not available". */
internal fun appUpdateResult(info: PlayUpdateInfo?, installedVersionCode: Long?): Map<String, Any> {
  if (info == null) return NOT_AVAILABLE
  val found = mapOf("available" to true, "versionCode" to info.versionCode)
  if (info.installStatus == InstallStatus.DOWNLOADED) return found + ("downloaded" to true)
  if (installedVersionCode != null && info.versionCode <= installedVersionCode) return NOT_AVAILABLE
  val offered = info.availability == UpdateAvailability.UPDATE_AVAILABLE && info.flexibleAllowed
  val running = info.availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
  return if (offered || running) found + ("downloaded" to false) else NOT_AVAILABLE
}

/** Play's flow result: only Activity.RESULT_OK (-1) means the user accepted. */
internal fun startResult(resultCode: Int?): Map<String, Any> = mapOf("started" to (resultCode == -1), "downloaded" to false)

/** The onAppUpdateStatus event for a listener state; null while the download still runs. */
internal fun installEvent(status: Int): String? = when (status) {
  InstallStatus.DOWNLOADED -> "downloaded"
  InstallStatus.FAILED -> "failed"
  InstallStatus.CANCELED -> "canceled"
  else -> null
}

internal fun stopsListening(status: Int): Boolean = installEvent(status) != null || status == InstallStatus.INSTALLED

/** Play's flexible download right now, independent of the daily availability check. */
internal fun installProgress(info: PlayUpdateInfo?): String = when (info?.installStatus) {
  InstallStatus.DOWNLOADED -> "downloaded"
  InstallStatus.PENDING, InstallStatus.DOWNLOADING -> "downloading"
  else -> "none"
}

/** Only Play-installed builds ask Play; sideloaded and preview installs stay silent. */
internal fun isPlayInstall(installer: String?): Boolean = installer == "com.android.vending"

/** The installed versionCode and name, or null when the platform reports nothing usable. */
internal fun appBuildInfo(versionCode: Long?, versionName: String?): Map<String, Any?> = mapOf(
  "versionCode" to versionCode?.takeIf { it > 0 },
  "versionName" to versionName?.trim()?.takeIf { it.isNotEmpty() },
)

/**
 * Registers the install listener before asking Play, so a download that ends while Play
 * answers still reaches JS (JS ignores a repeat). A listener added here is removed again
 * when the answer shows nothing running; one that was already there is kept.
 */
internal suspend fun <T> listeningFirst(listen: () -> Boolean, stop: () -> Unit, query: suspend () -> T, running: (T) -> Boolean): T {
  val added = listen()
  val answer = try { query() } catch (error: Throwable) { if (added) stop(); throw error }
  if (added && !running(answer)) stop()
  return answer
}
