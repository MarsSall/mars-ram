package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

class WatchStateNoticesTest {
  private val notices = listOf(
    WatchNotificationKey(null, 7200),
    WatchNotificationKey("unlock:pc", 7201),
    WatchNotificationKey("unlock:other", 7201),
    WatchNotificationKey("lost:pc", 7201),
    WatchNotificationKey("session:pc:finished", 7201),
    WatchNotificationKey("session:pc:needs-response", 7201),
    WatchNotificationKey("session:pc:failed", 7201),
    WatchNotificationKey(null, 9999),
  )

  @Test fun stoppingOrSwitchingCancelsOnlyPreviousWatchState() {
    assertEquals(notices.take(4), watchStateNoticesToCancel(notices))
    assertTrue(watchStateNoticesToCancel(emptyList()).isEmpty())
  }

  @Test fun recoveryCancelsOnlyThatHostsUnlockAndOutageNotices() {
    assertEquals(listOf(notices[1], notices[3]), watchStateNoticesToCancel(notices, "pc"))
    assertTrue(watchStateNoticesToCancel(notices, "unknown").isEmpty())
  }

  @Test fun recoveredHostCanNeedUnlockAgainAfterAnotherFailure() {
    val rules = SessionWatchRules(0)
    assertTrue(rules.needsUnlock("pc"))
    assertFalse(rules.needsUnlock("pc"))
    rules.recovered("pc")
    assertTrue(rules.needsUnlock("pc"))
  }
}
