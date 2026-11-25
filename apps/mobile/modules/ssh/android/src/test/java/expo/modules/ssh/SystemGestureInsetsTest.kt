package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

class SystemGestureInsetsTest {
  @Test fun convertsPixelsToDpRoundingUpSoTheStripClearsTheZone() {
    // Samsung S24 Ultra, gesture navigation, density 450 (2.8125): mandatory 90 px, nav bar 42 px.
    assertEquals(mapOf("mandatoryBottom" to 32.0, "navigationBottom" to 15.0), systemGestureInsetsDp(34, 90, 42, 2.8125f))
    assertEquals(mapOf("mandatoryBottom" to 0.0, "navigationBottom" to 48.0), systemGestureInsetsDp(34, 0, 126, 2.625f))
  }

  @Test fun unavailableBeforeAndroid10OrWithoutInsets() {
    assertNull(systemGestureInsetsDp(28, 90, 42, 2.8125f))
    assertNull(systemGestureInsetsDp(34, null, 42, 2.8125f))
    assertNull(systemGestureInsetsDp(34, 90, null, 2.8125f))
    assertNull(systemGestureInsetsDp(34, 90, 42, 0f))
    assertNull(systemGestureInsetsDp(34, -1, 42, 2.8125f))
  }
}
