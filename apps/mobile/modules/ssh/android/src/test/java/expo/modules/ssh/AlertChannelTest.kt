package expo.modules.ssh

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertChannelTest {
  // Owner chose heads-up alerts with vibration. Android fixes a channel's importance at creation,
  // so the high-importance channel needs a new id and the old default channel is removed.
  @Test fun sessionAlertsAreHeadsUpWithVibrationOnANewChannel() {
    assertEquals("session-alerts-high", ALERT_CHANNEL.id)
    assertEquals(4, ALERT_CHANNEL.importance) // NotificationManager.IMPORTANCE_HIGH
    assertTrue(ALERT_CHANNEL.vibrate)
    assertEquals(listOf("session-alerts"), RETIRED_ALERT_CHANNELS)
  }
}
