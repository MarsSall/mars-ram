package expo.modules.ssh

import android.app.Activity
import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import com.google.android.gms.tasks.Task
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val PLAY_TIMEOUT_MS = 10_000L

private fun packageInfo(context: Context): PackageInfo =
  if (Build.VERSION.SDK_INT >= 33) context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
  else @Suppress("DEPRECATION") context.packageManager.getPackageInfo(context.packageName, 0)

/** The installed Android versionCode and versionName; nulls when unreadable. */
internal fun installedBuild(context: Context?): Map<String, Any?> {
  val info = context?.let { runCatching { packageInfo(it) }.getOrNull() }
  return appBuildInfo(info?.let { PackageInfoCompat.getLongVersionCode(it) }, info?.versionName)
}

private fun installer(context: Context): String? = runCatching {
  if (Build.VERSION.SDK_INT >= 30) context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
  else @Suppress("DEPRECATION") context.packageManager.getInstallerPackageName(context.packageName)
}.getOrNull()

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
  addOnSuccessListener { continuation.resume(it) }
  addOnFailureListener { continuation.resumeWithException(it) }
}

/**
 * Google Play In-App Updates, flexible flow only. Play performs the check; nothing
 * is sent by the app. Builds not installed by Play never ask; every failure (no Play,
 * offline) is "not available". onStatus receives "downloaded", "failed" or "canceled".
 */
internal class PlayAppUpdates(private val context: Context, private val onStatus: (String) -> Unit) {
  private val manager: AppUpdateManager by lazy { AppUpdateManagerFactory.create(context) }
  private val fromPlay: Boolean by lazy { isPlayInstall(installer(context)) }
  private var listener: InstallStateUpdatedListener? = null
  /** A started flow owns the listener; a check that found nothing running must not drop it. */
  private var flowListening = false

  private suspend fun info(): AppUpdateInfo? = if (!fromPlay) null else
    runCatching { withTimeoutOrNull(PLAY_TIMEOUT_MS) { manager.appUpdateInfo.await() } }.getOrNull()

  private fun fields(info: AppUpdateInfo) =
    PlayUpdateInfo(info.updateAvailability(), info.installStatus(), info.availableVersionCode(), info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE))

  private fun installedVersionCode(): Long? = installedBuild(context)["versionCode"] as Long?

  private fun downloading(info: AppUpdateInfo) = info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS &&
    info.installStatus() != InstallStatus.DOWNLOADED

  suspend fun check(): Map<String, Any> {
    val info = listeningFirst(::listen, ::dropUnlessFlow, ::info) { it != null && downloading(it) }
    return appUpdateResult(info?.let(::fields), installedVersionCode())
  }

  /** On every app start: a running download is listened to again, so its end reaches JS. */
  suspend fun progress(): String =
    listeningFirst(::listen, ::dropUnlessFlow, { installProgress(info()?.let(::fields)) }) { it == "downloading" }

  /** Shows Play's flexible prompt; the download continues in Play while the app is used. */
  suspend fun start(activity: Activity?): Map<String, Any> {
    if (activity == null) return startResult(null)
    // Listening before asking, as in listeningFirst: a download ending meanwhile still reaches JS.
    listenForFlow()
    val info = info() ?: return startResult(null).also { stopListening() }
    if (info.installStatus() == InstallStatus.DOWNLOADED) { stopListening(); return mapOf("started" to false, "downloaded" to true) }
    if (downloading(info)) return startResult(-1)
    val offered = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
    if (!offered) return startResult(null).also { stopListening() }
    val code = runCatching {
      withContext(Dispatchers.Main) { manager.startUpdateFlow(info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE)).await() }
    }.getOrNull()
    return startResult(code).also { if (it["started"] != true) stopListening() }
  }

  /** Play installs the downloaded update and restarts the app. */
  suspend fun complete() {
    runCatching { withContext(Dispatchers.Main) { manager.completeUpdate().await() } }
  }

  /** True only when this call registered a new listener. */
  @Synchronized private fun listen(): Boolean {
    if (listener != null) return false
    val next = InstallStateUpdatedListener { state ->
      val status = state.installStatus()
      if (stopsListening(status)) stopListening()
      installEvent(status)?.let(onStatus)
    }
    return runCatching { manager.registerListener(next) }.onSuccess { listener = next }.isSuccess
  }

  @Synchronized private fun listenForFlow() {
    listen()
    flowListening = listener != null
  }

  @Synchronized private fun dropUnlessFlow() {
    if (!flowListening) stopListening()
  }

  @Synchronized fun stopListening() {
    listener?.let { runCatching { manager.unregisterListener(it) } }
    listener = null
    flowListening = false
  }
}
