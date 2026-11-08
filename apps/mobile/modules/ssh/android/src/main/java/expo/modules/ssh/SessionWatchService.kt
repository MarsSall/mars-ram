package expo.modules.ssh

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

class WatchHostOptions : Record {
  @Field val hostId: String = ""
  @Field val connection: ConnectOptions = ConnectOptions()
  @Field val hostKeyId: String = ""
}
class SessionWatchConfig : Record {
  @Field val appId: String = ""
  @Field val mode: String = "while-working"
  @Field val language: String = "en"
  @Field val hosts: List<WatchHostOptions> = emptyList()
}
internal data class WatchConfiguration(val appId: String, val hosts: List<WatchHost>, val mode: String, val alwaysHosts: List<AlwaysWatchHost>)

/** Explicit, visible-Activity-only entry point. No boot receiver, persisted toggle, or sticky restart. */
/** A lifecycle re-arm reuses the armed configuration but must keep the app's latest language. */
internal fun watchLanguage(configLanguage: String, current: String, rearm: Boolean): String =
  if (rearm) current else if (configLanguage == "es") "es" else "en"

/** Enumerate owned notices, rather than cancelAll(): session outcomes must survive a stop. */
internal fun clearWatchStateNotifications(context: Context, recoveredHost: String? = null) {
  val manager = context.getSystemService(NotificationManager::class.java)
  val active = manager.activeNotifications.map { WatchNotificationKey(it.tag, it.id) }
  watchStateNoticesToCancel(active, recoveredHost).forEach { manager.cancel(it.tag, it.id) }
}

internal data class AlertChannelSpec(val id: String, val importance: Int, val vibrate: Boolean)

/** Session alerts pop up (heads-up, edge lighting) and vibrate; 4 = NotificationManager.IMPORTANCE_HIGH. */
internal val ALERT_CHANNEL = AlertChannelSpec("session-alerts-high", 4, vibrate = true)
/** Channel importance is fixed at creation, so earlier alert channels are deleted. */
internal val RETIRED_ALERT_CHANNELS = listOf("session-alerts")

internal data class NoticeTap(val action: String, val uri: String)

/** The notification tap as a deep link the app's router receives on cold and warm launch. */
internal fun noticeTap(packageName: String, host: String, bridge: String): NoticeTap {
  val scheme = if (packageName.endsWith(".preview")) "mars-ram-preview" else "mars-ram"
  return NoticeTap("android.intent.action.VIEW", "$scheme://notice?h=$host&b=$bridge&encoding=utf16-hex")
}

internal object SessionWatchControl {
  private var pending: Pair<String, WatchConfiguration>? = null
  @Volatile var language: String = "en"
  private var armed: SessionWatchConfig? = null
  private var lifecycleRegistered = false
  private fun arm(activity: FragmentActivity, config: SessionWatchConfig) {
    armed = config
    if (lifecycleRegistered) return
    lifecycleRegistered = true
    activity.application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityPrePaused(activity: Activity) {
        // Pre-pause runs before ON_PAUSE: the Activity is still RESUMED. This
        // re-arms an idle-expired watch on leaving, never starts from background.
        val next = armed ?: return
        if (next.mode == "while-working" && status["state"] == "stopped") start(activity as? FragmentActivity, next, rearm = true)
      }
      override fun onActivityCreated(activity: Activity, state: android.os.Bundle?) {}
      override fun onActivityStarted(activity: Activity) {}
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {
        // Before API 29 there is no pre-pause callback. PAUSED is still visible
        // (STARTED); only this lifecycle edge may use it, never onStop/background.
        val next = armed ?: return
        if (Build.VERSION.SDK_INT < 29 && next.mode == "while-working" && status["state"] == "stopped") start(activity as? FragmentActivity, next, leavingVisible = true, rearm = true)
      }
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, state: android.os.Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
  }
  @Volatile var status: Map<String, Any?> = mapOf("state" to "stopped", "hosts" to emptyMap<String, String>())

  @Synchronized fun start(activity: FragmentActivity?, config: SessionWatchConfig, leavingVisible: Boolean = false, rearm: Boolean = false): Map<String, Any?> {
    val requiredState = if (Build.VERSION.SDK_INT < 29 && leavingVisible) Lifecycle.State.STARTED else Lifecycle.State.RESUMED
    if (activity == null || !activity.lifecycle.currentState.isAtLeast(requiredState)) return error("APP_NOT_VISIBLE")
    val alwaysHosts = config.hosts.map { AlwaysWatchHost(it.hostId, it.hostKeyId) }
    if (!Regex("[a-z0-9][a-z0-9-]{0,62}").matches(config.appId) || config.mode !in setOf("while-working", "always")) return error("INVALID_CONFIG")
    if (config.mode == "always") {
      if (!validAlwaysWatchHosts(alwaysHosts)) return error("INVALID_CONFIG")
    } else if (config.hosts.isEmpty() || config.hosts.size > 32 || config.hosts.map { it.hostId }.toSet().size != config.hosts.size || config.hosts.any {
      !validWatchHostId(it.hostId) || it.connection.host.isBlank() || it.connection.username.isBlank() ||
        it.connection.keyAlias.isBlank() || it.connection.port !in 1..65535 || it.connection.expectedFingerprint.isNullOrBlank()
    }) return error("INVALID_CONFIG")
    if ((Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) ||
      !NotificationManagerCompat.from(activity).areNotificationsEnabled()) return error("NOTIFICATIONS_DENIED")
    language = watchLanguage(config.language, language, rearm)
    val token = UUID.randomUUID().toString()
    pending = token to WatchConfiguration(config.appId, if (config.mode == "always") emptyList() else config.hosts.map {
      val c = it.connection
      WatchHost(it.hostId, c.host, c.fallbackHost, c.port, c.username, c.keyAlias, c.expectedFingerprint!!)
    }, config.mode, alwaysHosts)
    return try {
      ContextCompat.startForegroundService(activity, Intent(activity, SessionWatchService::class.java).putExtra("request", token))
      arm(activity, config)
      status = mapOf("state" to "starting", "hosts" to emptyMap<String, String>())
      mapOf("ok" to true)
    } catch (_: ForegroundServiceStartNotAllowedException) {
      pending = null
      error("START_NOT_ALLOWED")
    } catch (_: SecurityException) {
      pending = null
      error("PERMISSION_DENIED")
    } catch (_: IllegalStateException) {
      pending = null
      error("START_NOT_ALLOWED")
    }
  }
  @Synchronized fun take(token: String?): WatchConfiguration? {
    if (pending?.first != token) return null
    return pending?.second.also { pending = null }
  }
  /** The running «while working» source, so a UI connect can resume a host parked for an unlock. */
  private val watcher = WatchAttachment()
  fun attach(source: SessionEventSource, hosts: List<WatchHost>) = watcher.attach(source, hosts)
  fun detach(source: SessionEventSource) = watcher.detach(source)
  fun connected(context: Context, options: ConnectOptions) {
    // The source may have parked a host for S6. A visible UI connect clears its notice and
    // resumes it, adopting this live connection; hosts failing otherwise are not affected.
    // Matched against the running source's own hosts: during a reconfiguration the newer
    // armed configuration belongs to a source that has not attached yet.
    val (source, ids) = watcher.resume(options.host, options.port, options.username, options.keyAlias, options.expectedFingerprint) ?: return
    ids.forEach {
      clearWatchStateNotifications(context, it)
      source.unlocked(it)
    }
  }
  @Synchronized fun stop(context: Context) {
    armed = null
    pending = null
    context.stopService(Intent(context, SessionWatchService::class.java))
    clearWatchStateNotifications(context)
    status = mapOf("state" to "stopped", "hosts" to emptyMap<String, String>())
  }
  private fun error(code: String) = mapOf("ok" to false, "code" to code)
}

class SessionWatchService : Service() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var watching: Job? = null
  private val watchOwnership = Mutex()
  private var alwaysSource: AlwaysNoticeSource? = null
  private val ongoingChannel = "session-watch"
  private val alertChannel = ALERT_CHANNEL.id
  private val ongoingId = 7200
  private val spanish get() = SessionWatchControl.language == "es"
  private fun text(es: String, en: String) = if (spanish) es else en
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val config = SessionWatchControl.take(intent?.getStringExtra("request"))
    if (config == null) { if (watching == null) stopSelf(startId); return START_NOT_STICKY }
    alwaysSource?.close()
    watching?.cancel()
    clearWatchStateNotifications(this)
    val manager = getSystemService(NotificationManager::class.java)
    val channel = if (config.mode == "always") "session-watch-always" else ongoingChannel
    if (Build.VERSION.SDK_INT >= 26) {
      if (config.mode == "always") manager.createNotificationChannel(NotificationChannel(channel, text("Siempre atento", "Always attentive"), NotificationManager.IMPORTANCE_MIN))
      manager.createNotificationChannel(NotificationChannel(ongoingChannel, text("Sesiones en seguimiento", "Session watch"), NotificationManager.IMPORTANCE_LOW))
      RETIRED_ALERT_CHANNELS.forEach { manager.deleteNotificationChannel(it) }
      manager.createNotificationChannel(NotificationChannel(alertChannel, text("Avisos de sesiones", "Session alerts"), ALERT_CHANNEL.importance).apply {
        enableVibration(ALERT_CHANNEL.vibrate)
      })
    }
    val ongoingText = if (config.mode == "always") text("Siempre atento", "Always attentive") else text("Siguiendo sesiones", "Watching sessions")
    val ongoing = notification(channel, ongoingText, null).setOngoing(true).setAutoCancel(false).setSilent(true)
      .setPriority(if (config.mode == "always") NotificationCompat.PRIORITY_MIN else NotificationCompat.PRIORITY_LOW).build()
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(ongoingId, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      else startForeground(ongoingId, ongoing)
    } catch (_: SecurityException) {
      SessionWatchControl.status = mapOf("state" to "error", "code" to "PERMISSION_DENIED", "hosts" to emptyMap<String, String>())
      stopSelf(startId)
      return START_NOT_STICKY
    } catch (_: ForegroundServiceStartNotAllowedException) {
      SessionWatchControl.status = mapOf("state" to "error", "code" to "START_NOT_ALLOWED", "hosts" to emptyMap<String, String>())
      stopSelf(startId)
      return START_NOT_STICKY
    }
    watching = scope.launch { watchOwnership.withLock {
      // Serialize complete cleanup, including rapid A → B → C mode changes.
      if (config.mode == "always") { watchAlways(config, startId); return@withLock }
      val source: SessionEventSource = SshSessionEventSource(config.appId)
      SessionWatchControl.attach(source, config.hosts)
      val rules = SessionWatchRules(SystemClock.elapsedRealtime())
      val hosts = config.hosts.associate { it.id to "connecting" }.toMutableMap()
      fun publish() { SessionWatchControl.status = mapOf("state" to "running", "mode" to "while-working", "hosts" to hosts.toMap()) }
      publish()
      val timeout = launch {
        while (isActive) {
          delay(5_000)
          if (rules.shouldStop(SystemClock.elapsedRealtime())) { stopSelf(startId); break }
        }
      }
      try {
        withContext(Dispatchers.IO) { source.configure(config.hosts) }
        source.events().collect { event ->
          val now = SystemClock.elapsedRealtime()
          when (event) {
            is WatchEvent.Snapshot -> rules.snapshot(event.key, event.project, event.seq, event.active, now, event.waiting, event.protocolVersion)
            is WatchEvent.Removed -> rules.remove(event.key, now)
            is WatchEvent.Event -> rules.event(event.key, event.seq, event.type, event.outcome, event.aborted, now, event.protocolVersion)?.let { alert ->
              sessionAlert(alert)
            }
            is WatchEvent.HostState -> {
              hosts[event.hostId] = event.state
              publish()
              when (event.state) {
                "connected" -> {
                  rules.recovered(event.hostId)
                  clearWatchStateNotifications(this@SessionWatchService, event.hostId)
                }
                "connection-lost" -> if (rules.connectionLost(event.hostId)) notify("lost:${event.hostId}", text("Se perdió la conexión", "Connection lost"), null)
                "unlock-required" -> if (rules.needsUnlock(event.hostId)) notify("unlock:${event.hostId}", text("desbloqueá para seguir recibiendo avisos", "unlock to keep receiving notifications"), null)
              }
            }
          }
        }
      } catch (e: CancellationException) { throw e
      } catch (_: Exception) {
        SessionWatchControl.status = mapOf("state" to "error", "code" to "WATCH_FAILED", "hosts" to hosts.toMap())
        stopSelf(startId)
      } finally {
        timeout.cancel()
        SessionWatchControl.detach(source)
        withContext(NonCancellable + Dispatchers.IO) { source.close() }
      }
    } }
    return START_NOT_STICKY
  }

  private suspend fun watchAlways(config: WatchConfiguration, startId: Int) {
    var source: AlwaysNoticeSource? = null
    try {
      SessionWatchControl.status = mapOf("state" to "starting", "mode" to "always", "hosts" to emptyMap<String, String>())
      val vault = withContext(Dispatchers.IO) { AlwaysNotifySecrets.get(this@SessionWatchService) }
      val listener = TcpAlwaysNoticeSource(vault, config.alwaysHosts) {
        SessionWatchControl.status = mapOf("state" to "running", "mode" to "always", "hosts" to emptyMap<String, String>())
      }
      source = listener
      alwaysSource = listener
      listener.events().collect { sessionAlert(it) }
    } catch (e: CancellationException) { throw e
    } catch (e: Exception) {
      SessionWatchControl.status = mapOf("state" to "error", "mode" to "always", "code" to if (e is AlwaysListenerUnavailable) "TAILSCALE_REQUIRED" else "WATCH_FAILED", "hosts" to emptyMap<String, String>())
      stopSelf(startId)
    } finally {
      source?.close()
      if (alwaysSource === source) alwaysSource = null
    }
  }
  private fun sessionAlert(alert: SessionAlert) {
    val state = when (alert.notice) {
      WatchNotice.NEEDS_RESPONSE -> text("necesita tu respuesta", "needs your response")
      WatchNotice.COMPLETED -> text("terminó", "finished")
      WatchNotice.FAILED -> text("falló", "failed")
    }
    notify("session:${notificationWatchId(alert.key.hostId)}:${notificationWatchId(alert.key.bridgeInstanceId)}", "${alert.project}: $state", alert.key)
  }

  private fun notification(channel: String, state: String, key: SessionKey?): NotificationCompat.Builder {
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (key != null) {
      // IDs were validated by the wire schema. Encode only at the notification boundary;
      // protocol-valid spaces, slashes, Unicode, etc. must not suppress a session's tap.
      val host = notificationWatchId(key.hostId)
      val bridge = notificationWatchId(key.bridgeInstanceId)
      intent.putExtra("sessionWatchHostId", host)
      intent.putExtra("sessionWatchBridgeInstanceId", bridge)
      intent.putExtra("sessionWatchIdEncoding", "utf16-hex")
      // React Native Linking reads only ACTION_VIEW intents (cold and warm); the per-session
      // URI keeps each PendingIntent distinct.
      val tap = noticeTap(packageName, host, bridge)
      intent.action = tap.action
      intent.data = android.net.Uri.parse(tap.uri)
    }
    val tap = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, channel)
      .setSmallIcon(applicationInfo.icon).setContentTitle(applicationInfo.loadLabel(packageManager)).setContentText(state)
      .setContentIntent(tap).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
  }
  private fun notify(tag: String, state: String, key: SessionKey?) {
    try { getSystemService(NotificationManager::class.java).notify(tag, 7201, notification(alertChannel, state, key).setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_STATUS).setDefaults(NotificationCompat.DEFAULT_ALL).build()) }
    catch (_: SecurityException) { /* Permission may be revoked while watching. Never request it here. */ }
  }
  override fun onDestroy() {
    alwaysSource?.close()
    scope.cancel()
    stopForeground(STOP_FOREGROUND_REMOVE)
    clearWatchStateNotifications(this)
    if (SessionWatchControl.status["state"] != "error") SessionWatchControl.status = mapOf("state" to "stopped", "hosts" to emptyMap<String, String>())
    super.onDestroy()
  }
}
