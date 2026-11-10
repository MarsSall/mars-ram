package expo.modules.ssh

import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import java.net.Inet4Address

internal const val TAILSCALE_PACKAGE = "com.tailscale.ipn"
internal const val ZEROTIER_PACKAGE = "com.zerotier.one"

/** What the connection wizard needs from one network; ipv4 holds raw 4-byte addresses. */
internal class NetworkFacts(
  val vpn: Boolean,
  val ipv4: List<ByteArray>,
  /** null below Android 9, where LinkProperties cannot tell. */
  val privateDnsActive: Boolean?,
  val privateDnsServer: String?,
)

/** Tailscale addresses come from 100.64.0.0/10 (CGNAT). */
internal fun isTailscaleAddress(address: ByteArray): Boolean =
  address.size == 4 && (address[0].toInt() and 0xff) == 100 && (address[1].toInt() and 0xc0) == 64

internal fun tailscaleOn(networks: List<NetworkFacts>): Boolean =
  networks.any { it.vpn && it.ipv4.any(::isTailscaleAddress) }

/**
 * Any VPN visible to this app. Android does not say which app owns a VPN, so the JS core reads ZeroTier as on
 * when this is true and tailscaleOn is false (Android runs one VPN at a time).
 */
internal fun vpnOn(networks: List<NetworkFacts>): Boolean = networks.any { it.vpn }

/**
 * Active Private DNS, in Automatic or provider-hostname mode, can send lookups past Tailscale and break
 * MagicDNS names: a tester's pairing hung with Automatic on (odd/tasks/connect-tutorial.md, L1).
 * null when the system cannot tell (Android < 9).
 */
internal fun privateDnsConflict(networks: List<NetworkFacts>, supported: Boolean): Boolean? =
  if (!supported) null else networks.any { it.privateDnsActive == true }

internal data class LaunchTarget(val action: String, val uri: String?)

/** The Play Store app first, then the web page. */
internal fun storeTargets(packageName: String) = listOf(
  LaunchTarget("android.intent.action.VIEW", "market://details?id=$packageName"),
  LaunchTarget("android.intent.action.VIEW", "https://play.google.com/store/apps/details?id=$packageName"),
)

internal val INSTALL_TAILSCALE_TARGETS = storeTargets(TAILSCALE_PACKAGE)
internal val INSTALL_ZEROTIER_TARGETS = storeTargets(ZEROTIER_PACKAGE)

/** Android has no public Private DNS screen; the network settings are the closest public one. */
internal val PRIVATE_DNS_SETTINGS_TARGETS = listOf(
  LaunchTarget("android.settings.WIRELESS_SETTINGS", null),
  LaunchTarget("android.settings.SETTINGS", null),
)

/** Tries each target in order until one launches; a thrown launch counts as unavailable. */
internal fun launchFirst(targets: List<LaunchTarget>, launch: (LaunchTarget) -> Boolean): Boolean =
  targets.any { runCatching { launch(it) }.getOrDefault(false) }

internal fun packageInstalled(packageManager: PackageManager, name: String): Boolean = try {
  if (Build.VERSION.SDK_INT >= 33) packageManager.getPackageInfo(name, PackageManager.PackageInfoFlags.of(0))
  else @Suppress("DEPRECATION") packageManager.getPackageInfo(name, 0)
  true
} catch (_: PackageManager.NameNotFoundException) {
  false
}

/** Every network visible to this app; a VPN shows only when it covers the app. Needs ACCESS_NETWORK_STATE. */
internal fun readNetworkFacts(context: Context): List<NetworkFacts> {
  val manager = context.getSystemService(ConnectivityManager::class.java) ?: return emptyList()
  @Suppress("DEPRECATION") val networks = manager.allNetworks
  return networks.mapNotNull { network ->
    val capabilities = manager.getNetworkCapabilities(network) ?: return@mapNotNull null
    val link = manager.getLinkProperties(network) ?: return@mapNotNull null
    NetworkFacts(
      vpn = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN),
      ipv4 = link.linkAddresses.mapNotNull { (it.address as? Inet4Address)?.address },
      privateDnsActive = if (Build.VERSION.SDK_INT >= 28) link.isPrivateDnsActive else null,
      privateDnsServer = if (Build.VERSION.SDK_INT >= 28) link.privateDnsServerName else null,
    )
  }
}

/** privateDnsActive is omitted, not null, when unknown; the JS adapter reads a missing key as null. */
internal fun phoneNetworkState(context: Context): Map<String, Any> {
  val networks = runCatching { readNetworkFacts(context) }.getOrDefault(emptyList())
  val state = mutableMapOf<String, Any>(
    "tailscaleInstalled" to packageInstalled(context.packageManager, TAILSCALE_PACKAGE),
    "tailscaleOn" to tailscaleOn(networks),
    "zerotierInstalled" to packageInstalled(context.packageManager, ZEROTIER_PACKAGE),
    "vpnOn" to vpnOn(networks),
  )
  privateDnsConflict(networks, Build.VERSION.SDK_INT >= 28)?.let { state["privateDnsActive"] = it }
  return state
}
