package expo.modules.ssh

internal data class SessionKey(val hostId: String, val bridgeInstanceId: String)
internal enum class WatchNotice { NEEDS_RESPONSE, COMPLETED, FAILED }
internal data class SessionAlert(val key: SessionKey, val project: String, val notice: WatchNotice)

/** Pure product policy. The service serializes all calls on its collector coroutine. */
internal class SessionWatchRules(startedAt: Long) {
  private data class Session(val project: String, var seq: Long, var working: Boolean, var waiting: Boolean, val protocolVersion: String) {
    val active get() = working || waiting
  }
  private val sessions = mutableMapOf<SessionKey, Session>()
  private val outages = mutableSetOf<String>()
  private val locked = mutableSetOf<String>()
  private var lastChange = startedAt
  private var inactiveSince: Long? = startedAt

  fun snapshot(key: SessionKey, project: String, seq: Long, active: Boolean, now: Long, waiting: Boolean = false, protocolVersion: String = "1.6") {
    val old = sessions[key]
    if (old != null && seq < old.seq) return
    if (old == null || old.working != active || old.waiting != waiting) lastChange = now
    sessions[key] = Session(project, maxOf(seq, old?.seq ?: 0), active, waiting, protocolVersion)
    updateIdle(now)
  }

  fun event(key: SessionKey, seq: Long, type: String, outcome: String? = null, aborted: Boolean = false, now: Long, protocolVersion: String? = null): SessionAlert? {
    val session = sessions[key] ?: return null // No baseline, no inferred outcome.
    if (seq <= session.seq) return null
    session.seq = seq
    // Content chunks and keepalives do not keep a watch alive indefinitely.
    if (type in setOf("agent_start", "agent_settled", "prompt_start", "prompt_end", "activity", "session_start")) lastChange = now
    when (type) {
      "agent_start" -> session.working = true
      "agent_settled" -> session.working = false
      "prompt_start" -> session.waiting = true
      "prompt_end" -> session.waiting = false
    }
    updateIdle(now)
    val notice = when {
      type == "prompt_start" -> WatchNotice.NEEDS_RESPONSE
      type != "agent_settled" || aborted || outcome == "aborted" -> null
      outcome == "failed" -> WatchNotice.FAILED
      outcome == "completed" -> WatchNotice.COMPLETED
      outcome == null && legacyWatchOutcomes(protocolVersion ?: session.protocolVersion) -> WatchNotice.COMPLETED
      else -> null
    }
    return notice?.let { SessionAlert(key, session.project, it) }
  }

  fun remove(key: SessionKey, now: Long) {
    if (sessions.remove(key) != null) lastChange = now
    updateIdle(now)
  }
  fun connectionLost(hostId: String): Boolean = outages.add(hostId)
  fun recovered(hostId: String) { outages.remove(hostId); locked.remove(hostId) }
  fun needsUnlock(hostId: String): Boolean = locked.add(hostId)
  fun shouldStop(now: Long): Boolean = now - lastChange >= 2 * 60 * 60 * 1000L || inactiveSince?.let { now - it >= 2 * 60 * 1000L } == true
  private fun updateIdle(now: Long) {
    if (sessions.values.any { it.active }) inactiveSince = null
    else if (inactiveSince == null) inactiveSince = now
  }
}
