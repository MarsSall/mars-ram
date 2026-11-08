package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

class SessionWatchRulesTest {
  private val key = SessionKey("host", "bridge")
  private fun baseline(rules: SessionWatchRules, active: Boolean = true, seq: Long = 10) =
    rules.snapshot(key, "project", seq, active, 0)

  @Test fun snapshotAndReplayAreSilent() {
    val rules = SessionWatchRules(0)
    baseline(rules)
    assertNull(rules.event(key, 10, "prompt_start", now = 1))
    assertEquals(WatchNotice.NEEDS_RESPONSE, rules.event(key, 11, "prompt_start", now = 2)?.notice)
    assertNull(rules.event(key, 11, "prompt_start", now = 3))
    assertEquals(WatchNotice.COMPLETED, rules.event(key, 12, "agent_settled", outcome = "completed", aborted = false, now = 4)?.notice)
  }

  @Test fun outcomesAndLegacyFallbackNeverNotifyAbort() {
    for (version in listOf("1.0", "1.5", "01.005", "1.6", "1.7", "1.60", "1." + "9".repeat(100))) {
      val legacy = version in listOf("1.0", "1.5", "01.005")
      for ((outcome, aborted, expected) in listOf(
        Triple("completed", false, WatchNotice.COMPLETED), Triple("failed", false, WatchNotice.FAILED),
        Triple("aborted", false, null), Triple("completed", true, null), Triple("failed", true, null),
        Triple(null, true, null), Triple(null, false, if (legacy) WatchNotice.COMPLETED else null), Triple("future", false, null),
      )) {
        val rules = SessionWatchRules(0)
        rules.snapshot(key, "project", 10, true, 0, protocolVersion = version)
        assertEquals("version=$version outcome=$outcome aborted=$aborted", expected,
          rules.event(key, 11, "agent_settled", outcome, aborted, 1)?.notice)
      }
    }
  }

  @Test fun eventCarriesRegistryVersionAndOverridesSnapshotVersion() {
    val rules = SessionWatchRules(0)
    rules.snapshot(key, "project", 10, true, 0, protocolVersion = "1.5")
    val event = WatchEvent.Event(key, 11, "agent_settled", null, false, "1.6")
    assertNull(rules.event(event.key, event.seq, event.type, event.outcome, event.aborted, 1, event.protocolVersion))
    val snapshot = WatchEvent.Snapshot(key, "project", 12, true, false, "1.7")
    rules.snapshot(snapshot.key, snapshot.project, snapshot.seq, snapshot.active, 2, snapshot.waiting, snapshot.protocolVersion)
    assertNull(rules.event(key, 13, "agent_settled", null, false, 3))
  }

  @Test fun modernMissingOutcomeIsUnknownNotCompleted() {
    val rules = SessionWatchRules(0)
    baseline(rules)
    assertNull(rules.event(key, 11, "agent_settled", outcome = null, aborted = false, now = 1))
  }

  @Test fun dedupIsScopedToHostAndInstance() {
    val rules = SessionWatchRules(0)
    for (k in listOf(key, SessionKey("other-host", "bridge"), SessionKey("host", "other-bridge"))) {
      rules.snapshot(k, "project", 10, true, 0)
      assertNotNull(rules.event(k, 11, "prompt_start", now = 1))
    }
  }

  @Test fun gapResnapshotDoesNotInventOutcomeOrRewindCursor() {
    val rules = SessionWatchRules(0)
    baseline(rules)
    rules.snapshot(key, "project", 30, false, 1)
    assertNull(rules.event(key, 29, "agent_settled", "failed", false, 2))
    rules.snapshot(key, "project", 20, false, 3)
    assertNull(rules.event(key, 30, "prompt_start", now = 4))
  }

  @Test fun outagesAndUnlockAreOnceUntilRecoveryOrRestart() {
    val rules = SessionWatchRules(0)
    assertTrue(rules.connectionLost("host"))
    assertFalse(rules.connectionLost("host"))
    rules.recovered("host")
    assertTrue(rules.connectionLost("host"))
    assertTrue(rules.needsUnlock("host"))
    assertFalse(rules.needsUnlock("host"))
    rules.recovered("host")
    // Recovery dismisses the old notice; a later locked reconnect needs a fresh one.
    assertTrue(rules.needsUnlock("host"))
  }

  @Test fun stopsAtTwoHoursWithoutMeaningfulChangeNotNetworkTraffic() {
    val rules = SessionWatchRules(0)
    baseline(rules)
    rules.event(key, 11, "text_delta", now = 7_199_999)
    rules.snapshot(key, "project", 11, true, 7_199_999)
    assertFalse(rules.shouldStop(7_199_999))
    assertTrue(rules.shouldStop(7_200_000))
  }

  @Test fun anySessionsMeaningfulChangeResetsGlobalDeadline() {
    val rules = SessionWatchRules(0)
    baseline(rules)
    val other = SessionKey("other", "bridge")
    rules.snapshot(other, "other", 0, true, 1_000_000)
    rules.event(other, 1, "activity", now = 7_000_000)
    assertFalse(rules.shouldStop(7_200_000))
    assertTrue(rules.shouldStop(14_200_000))
  }

  @Test fun noActiveSessionsHaveTwoMinuteGraceIncludingEmptyStartup() {
    val rules = SessionWatchRules(0)
    assertFalse(rules.shouldStop(119_999))
    assertTrue(rules.shouldStop(120_000))
    baseline(rules)
    assertFalse(rules.shouldStop(120_000))
    rules.event(key, 11, "agent_settled", "completed", false, 200_000)
    assertFalse(rules.shouldStop(319_999))
    assertTrue(rules.shouldStop(320_000))
  }

  @Test fun waitingSurvivesSettleAndPromptEndStartsIdleGrace() {
    val rules = SessionWatchRules(0)
    rules.snapshot(key, "project", 10, false, 0, waiting = true)
    rules.event(key, 11, "agent_settled", "completed", false, 1000)
    assertFalse(rules.shouldStop(121_000))
    rules.event(key, 12, "prompt_end", now = 2000)
    assertFalse(rules.shouldStop(121_999))
    assertTrue(rules.shouldStop(122_000))
  }

  @Test fun newSessionDiscoveryResetsMeaningfulChangeDeadline() {
    val rules = SessionWatchRules(0)
    baseline(rules)
    rules.snapshot(SessionKey("host", "new"), "new", 0, true, 7_000_000)
    assertFalse(rules.shouldStop(7_200_000))
  }

  @Test fun removalStartsGraceButOneWaitingSessionKeepsAlive() {
    val rules = SessionWatchRules(0)
    baseline(rules)
    val other = SessionKey("host", "other")
    rules.snapshot(other, "other", 0, true, 1)
    rules.remove(key, 1000)
    assertFalse(rules.shouldStop(121_000))
    rules.remove(other, 2000)
    assertTrue(rules.shouldStop(122_000))
  }
}
