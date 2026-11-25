package expo.modules.ssh

internal data class SessionKey(val hostId: String, val bridgeInstanceId: String)
internal enum class WatchNotice { NEEDS_RESPONSE, COMPLETED, FAILED }
internal data class SessionAlert(val key: SessionKey, val project: String, val notice: WatchNotice, val agent: String? = null)

/** Pending approval ids one session tracks from events; a state lists at most 8. */
internal const val WATCH_APPROVALS_TRACKED = 64

/** Pure product policy. The service serializes all calls on its collector coroutine. */
internal class SessionWatchRules(startedAt: Long) {
  /** `prompt` is an open question; `approvals` are pending approval ids. Either one is waiting. */
  private class Session(val project: String, var seq: Long, var working: Boolean, var prompt: Boolean,
    val approvals: MutableSet<String>, val protocolVersion: String, val agent: String?) {
    val waiting get() = prompt || approvals.isNotEmpty()
    val active get() = working || waiting
  }
  private val sessions = mutableMapOf<SessionKey, Session>()
  private val outages = mutableSetOf<String>()
  private val locked = mutableSetOf<String>()
  private var lastChange = startedAt
  private var inactiveSince: Long? = startedAt

  fun snapshot(key: SessionKey, project: String, seq: Long, active: Boolean, now: Long, waiting: Boolean = false, protocolVersion: String = "1.6",
    approvals: Collection<String> = emptyList(), agent: String? = null) {
    val old = sessions[key]
    if (old != null && seq < old.seq) return
    val session = Session(project, maxOf(seq, old?.seq ?: 0), active, waiting, LinkedHashSet(approvals.take(WATCH_APPROVALS_MAX_ITEMS)), protocolVersion, agent)
    if (old == null || old.working != session.working || old.waiting != session.waiting) lastChange = now
    sessions[key] = session
    updateIdle(now)
  }

  fun event(key: SessionKey, seq: Long, type: String, outcome: String? = null, aborted: Boolean = false, now: Long, protocolVersion: String? = null,
    approvalId: String? = null): SessionAlert? {
    val session = sessions[key] ?: return null // No baseline, no inferred outcome.
    if (seq <= session.seq) return null
    session.seq = seq
    // An approval event without a valid id says nothing about which approval: ignored like unknown events.
    val approval = type in setOf("approval_request", "approval_resolved")
    if (approval && approvalId == null) return null
    // Content chunks and keepalives do not keep a watch alive indefinitely.
    if (approval || type in setOf("agent_start", "agent_settled", "prompt_start", "prompt_end", "activity", "session_start")) lastChange = now
    when (type) {
      "agent_start" -> session.working = true
      "agent_settled" -> session.working = false
      "prompt_start" -> session.prompt = true
      "prompt_end" -> session.prompt = false
      // Bounded so a hostile bridge cannot grow it; each id clears only itself.
      "approval_request" -> if (session.approvals.size < WATCH_APPROVALS_TRACKED) session.approvals.add(approvalId!!)
      "approval_resolved" -> session.approvals.remove(approvalId!!)
    }
    updateIdle(now)
    val notice = when {
      type == "prompt_start" || type == "approval_request" -> WatchNotice.NEEDS_RESPONSE
      type != "agent_settled" || aborted || outcome == "aborted" -> null
      outcome == "failed" -> WatchNotice.FAILED
      outcome == "completed" -> WatchNotice.COMPLETED
      outcome == null && legacyWatchOutcomes(protocolVersion ?: session.protocolVersion) -> WatchNotice.COMPLETED
      else -> null
    }
    return notice?.let { SessionAlert(key, session.project, it, session.agent) }
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
