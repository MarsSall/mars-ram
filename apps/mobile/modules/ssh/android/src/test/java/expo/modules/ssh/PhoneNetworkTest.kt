package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

class PhoneNetworkTest {
  private fun ip(vararg parts: Int) = ByteArray(4) { parts[it].toByte() }
  private fun network(vpn: Boolean, vararg addresses: ByteArray, dns: Boolean? = false, server: String? = null) =
    NetworkFacts(vpn, addresses.toList(), dns, server)

  @Test fun tailscaleRangeIsExactly100_64Slash10() {
    assertTrue(isTailscaleAddress(ip(100, 64, 0, 1)))
    assertTrue(isTailscaleAddress(ip(100, 127, 255, 254)))
    assertFalse(isTailscaleAddress(ip(100, 63, 255, 255)))
    assertFalse(isTailscaleAddress(ip(100, 128, 0, 1)))
    assertFalse(isTailscaleAddress(ip(10, 64, 0, 1)))
    assertFalse(isTailscaleAddress(ByteArray(16)))
  }

  @Test fun tailscaleIsOnOnlyForAVpnWithATailnetAddress() {
    assertTrue(tailscaleOn(listOf(network(false, ip(192, 168, 1, 5)), network(true, ip(100, 101, 2, 3)))))
    assertFalse(tailscaleOn(listOf(network(true, ip(10, 8, 0, 2)))))
    assertFalse(tailscaleOn(listOf(network(false, ip(100, 100, 1, 1)))))
    assertFalse(tailscaleOn(emptyList()))
  }

  @Test fun vpnIsOnForAnyVpnWhateverItsAddress() {
    assertTrue(vpnOn(listOf(network(false, ip(192, 168, 1, 5)), network(true, ip(10, 147, 20, 4)))))
    assertTrue(vpnOn(listOf(network(true, ip(100, 101, 2, 3)))))
    assertFalse(vpnOn(listOf(network(false, ip(100, 100, 1, 1)))))
    assertFalse(vpnOn(emptyList()))
  }

  @Test fun zeroTierStorePageFallsBackToTheWebPage() {
    assertEquals(
      listOf("market://details?id=com.zerotier.one", "https://play.google.com/store/apps/details?id=com.zerotier.one"),
      INSTALL_ZEROTIER_TARGETS.map { it.uri },
    )
    assertEquals(storeTargets(TAILSCALE_PACKAGE), INSTALL_TAILSCALE_TARGETS)
  }

  @Test fun privateDnsConflictsWhenActiveInAnyMode() {
    assertEquals(true, privateDnsConflict(listOf(network(false, dns = true, server = "dns.example")), true))
    assertEquals(true, privateDnsConflict(listOf(network(false, dns = true, server = null)), true))
    assertEquals(false, privateDnsConflict(listOf(network(true, dns = false)), true))
    assertEquals(false, privateDnsConflict(emptyList(), true))
    assertNull(privateDnsConflict(listOf(network(false, dns = null)), false))
  }

  @Test fun storeFallsBackToTheWebPageAndSettingsNeverUseHiddenScreens() {
    val opened = mutableListOf<LaunchTarget>()
    assertTrue(launchFirst(INSTALL_TAILSCALE_TARGETS) { opened.add(it); if (opened.size == 1) throw RuntimeException() else true })
    assertEquals(listOf("market://details?id=com.tailscale.ipn", "https://play.google.com/store/apps/details?id=com.tailscale.ipn"), opened.map { it.uri })
    assertFalse(launchFirst(PRIVATE_DNS_SETTINGS_TARGETS) { false })
    assertEquals(listOf("android.settings.WIRELESS_SETTINGS", "android.settings.SETTINGS"), PRIVATE_DNS_SETTINGS_TARGETS.map { it.action })
  }
}
