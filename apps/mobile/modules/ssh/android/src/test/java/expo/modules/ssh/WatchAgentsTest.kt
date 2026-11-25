package expo.modules.ssh

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class WatchAgentsTest {
  private fun approval(id: Any?, kind: Any? = "command", choices: Any? = listOf("accept", "decline")): Map<String, Any?> =
    mapOf("id" to id, "kind" to kind, "title" to "Run", "detail" to "ls", "choices" to choices)

  @Test fun noticeNamesClaudeCodeAndCodexInBothLanguages() {
    assertEquals("api (Claude Code): necesita tu respuesta", watchNoticeText("api", WatchNotice.NEEDS_RESPONSE, "claude-code", spanish = true))
    assertEquals("api (Claude Code): needs your response", watchNoticeText("api", WatchNotice.NEEDS_RESPONSE, "claude-code", spanish = false))
    assertEquals("api (Codex): terminó", watchNoticeText("api", WatchNotice.COMPLETED, "codex", spanish = true))
    assertEquals("api (Codex): failed", watchNoticeText("api", WatchNotice.FAILED, "codex", spanish = false))
  }

  @Test fun piAbsentAndUnknownAgentsKeepTodaysWording() {
    for (agent in listOf(null, "pi", "future-agent")) {
      assertEquals("api: necesita tu respuesta", watchNoticeText("api", WatchNotice.NEEDS_RESPONSE, agent, spanish = true))
      assertEquals("api: finished", watchNoticeText("api", WatchNotice.COMPLETED, agent, spanish = false))
      assertEquals("api: falló", watchNoticeText("api", WatchNotice.FAILED, agent, spanish = true))
    }
  }

  @Test fun agentAcceptsOnlyKnownStrings() {
    assertEquals("claude-code", watchAgent("claude-code"))
    assertEquals("codex", watchAgent("codex"))
    assertEquals("pi", watchAgent("pi"))
    for (value in listOf(null, "", "Claude-Code", "future", 1, true, listOf("codex"))) assertNull(watchAgent(value))
  }

  @Test fun approvalsBoundLikeTheProtocol() {
    assertEquals(emptyList<String>(), boundWatchApprovalIds(null))
    assertEquals(emptyList<String>(), boundWatchApprovalIds(mapOf("id" to "a")))
    assertEquals(emptyList<String>(), boundWatchApprovalIds("a"))
    val raw = listOf(
      approval("a"), "not an object", null, approval(""), approval("x".repeat(129)), approval("bad\nid"), approval("del\u007f"),
      approval(7), approval("kind", kind = "future"), approval("nochoice", choices = listOf("future")),
      approval("nolist", choices = "accept"), approval("a", kind = "permission"), approval("x".repeat(128)),
      approval("b", kind = "file-change", choices = listOf("future", "cancel")), approval("tab\tok"),
    )
    assertEquals(listOf("a", "x".repeat(128), "b"), boundWatchApprovalIds(raw))
  }

  @Test fun approvalsAreCappedAtEightInOrder() {
    val raw = (1..12).map { approval("id$it") }
    assertEquals((1..8).map { "id$it" }, boundWatchApprovalIds(raw))
  }

  @Test fun approvalsDecodeFromStateJson() {
    val json = JSONArray("""[{"id":"a","kind":"command","title":"t","detail":"d","choices":["accept"]},{"id":"b","kind":"command","choices":[]},5]""")
    assertEquals(listOf("a"), boundWatchApprovalIds(json))
  }

  @Test fun approvalIdMirrorsTheProtocol() {
    assertEquals("a b", watchApprovalId("a b"))
    for (value in listOf(null, "", "x".repeat(129), "a\u0000", "a\u001f", "a\u007f", 1)) assertNull(watchApprovalId(value))
  }
}
