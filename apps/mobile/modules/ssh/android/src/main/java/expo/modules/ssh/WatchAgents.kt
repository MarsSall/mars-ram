package expo.modules.ssh

import org.json.JSONArray
import org.json.JSONObject

/** Protocol 1.9 `agent` values; absent, unknown or malformed means a legacy Pi bridge. */
internal fun watchAgent(value: Any?): String? = (value as? String)?.takeIf { it in setOf("pi", "claude-code", "codex") }

/** The agent named in a notice, or null for Pi and unknown agents (today's wording). */
internal fun watchAgentName(agent: String?): String? = when (agent) {
  "claude-code" -> "Claude Code"
  "codex" -> "Codex"
  else -> null
}

/** Session notice text in the app's language; names Claude Code or Codex, never Pi. */
internal fun watchNoticeText(project: String, notice: WatchNotice, agent: String?, spanish: Boolean): String {
  val state = when (notice) {
    WatchNotice.NEEDS_RESPONSE -> if (spanish) "necesita tu respuesta" else "needs your response"
    WatchNotice.COMPLETED -> if (spanish) "terminó" else "finished"
    WatchNotice.FAILED -> if (spanish) "falló" else "failed"
  }
  val name = watchAgentName(agent) ?: return "$project: $state"
  return "$project ($name): $state"
}

internal const val WATCH_APPROVALS_MAX_ITEMS = 8
private val APPROVAL_KINDS = setOf("command", "file-change", "permission")
private val APPROVAL_DECISIONS = setOf("accept", "acceptForSession", "decline", "cancel")

/** Mirrors the protocol's approval id: 1–128 UTF-16 units, no C0 controls or DEL. */
internal fun watchApprovalId(value: Any?): String? = (value as? String)?.takeIf { id ->
  id.length in 1..128 && id.none { it.code < 32 || it.code == 127 }
}

private fun items(value: Any?): List<Any?>? = when (value) {
  is List<*> -> value
  is JSONArray -> (0 until value.length()).map { value.opt(it) }
  else -> null
}
private fun field(value: Any?, key: String): Any? = when (value) {
  is Map<*, *> -> value[key]
  is JSONObject -> value.opt(key)
  else -> null
}

/**
 * The pending approval ids of a state, by the same rule as `boundApprovals` in packages/protocol:
 * anything but a list is none; entries without a valid id, a known kind and at least one known
 * choice are dropped, as are repeated ids (first wins); order is kept, at most 8.
 */
internal fun boundWatchApprovalIds(raw: Any?): List<String> {
  val list = items(raw) ?: return emptyList()
  val kept = LinkedHashSet<String>()
  for (item in list) {
    if (item !is Map<*, *> && item !is JSONObject) continue
    val id = watchApprovalId(field(item, "id")) ?: continue
    if ((field(item, "kind") as? String)?.let { it in APPROVAL_KINDS } != true) continue
    if (items(field(item, "choices"))?.any { choice -> (choice as? String)?.let { it in APPROVAL_DECISIONS } == true } != true) continue
    if (!kept.add(id)) continue
    if (kept.size == WATCH_APPROVALS_MAX_ITEMS) break
  }
  return kept.toList()
}
