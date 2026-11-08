package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

class BatterySettingsTest {
  @Test fun opensOnlyOwnAppPageWhenAvailable() {
    val opened = mutableListOf<BatterySettingsTarget>()
    assertTrue(launchBatterySettings("app.preview") { opened.add(it); true })
    assertEquals(listOf(BatterySettingsTarget("android.settings.APPLICATION_DETAILS_SETTINGS", "package:app.preview")), opened)
  }

  @Test fun unresolvedOrRejectedAppPageFallsBackToBatteryList() {
    for (throws in listOf(false, true)) {
      val opened = mutableListOf<BatterySettingsTarget>()
      assertTrue(launchBatterySettings("app.preview") {
        opened.add(it)
        if (opened.size == 1) { if (throws) throw SecurityException(); false } else true
      })
      assertEquals(BatterySettingsTarget("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS", null), opened.last())
      assertEquals(2, opened.size)
    }
  }

  @Test fun unavailableSettingsReturnsFailureWithoutRequestingExemption() {
    val opened = mutableListOf<BatterySettingsTarget>()
    assertFalse(launchBatterySettings("app.preview") { opened.add(it); false })
    assertEquals(2, opened.size)
    assertFalse(opened.any { it.action == "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" })
  }
}
