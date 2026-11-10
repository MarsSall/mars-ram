package expo.modules.ssh

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.net.Inet4Address
import java.net.NetworkInterface

/** The Tailscale tun addresses, read exactly as before phase 2. */
internal fun readAlwaysTailscaleBindings(): List<AlwaysBinding> = alwaysTailscaleBindings(
  NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().flatMap { network ->
    network.inetAddresses.toList().filter { alwaysBindCandidate(network.name, network.isUp, it.address) }.map { it.address }
  },
)

/** IPv4 interface addresses of every network visible to this app; a VPN shows only when it covers the app. */
private fun readAlwaysLinkAddresses(context: Context): List<AlwaysLinkAddress> {
  val manager = context.getSystemService(ConnectivityManager::class.java) ?: return emptyList()
  @Suppress("DEPRECATION") val networks = manager.allNetworks
  return networks.flatMap { network ->
    val capabilities = manager.getNetworkCapabilities(network) ?: return@flatMap emptyList()
    val link = manager.getLinkProperties(network) ?: return@flatMap emptyList()
    val vpn = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
    link.linkAddresses.mapNotNull { address -> (address.address as? Inet4Address)?.let { AlwaysLinkAddress(vpn, it.address, address.prefixLength) } }
  }
}

/** Every eligible listening address now; a failure to read one source leaves the other. Blocking: call on IO. */
internal fun readAlwaysBindings(context: Context): List<AlwaysBinding> =
  runCatching { readAlwaysTailscaleBindings() }.getOrDefault(emptyList()) +
    runCatching { alwaysVpnBindings(readAlwaysLinkAddresses(context)) }.getOrDefault(emptyList())

/**
 * Fires when a network appears, goes away or changes addresses, including VPNs (NOT_VPN removed) and VPNs without a
 * default route (INTERNET removed). Capability changes are ignored: Wi-Fi signal updates would fire them constantly.
 */
internal fun alwaysNetworkChanges(context: Context): Flow<Unit> = callbackFlow {
  val manager = context.getSystemService(ConnectivityManager::class.java)
  if (manager == null) { awaitClose {}; return@callbackFlow }
  val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) { trySend(Unit) }
    override fun onLost(network: Network) { trySend(Unit) }
    override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) { trySend(Unit) }
  }
  val request = NetworkRequest.Builder()
    .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
    .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    .build()
  val registered = runCatching { manager.registerNetworkCallback(request, callback) }.isSuccess
  awaitClose { if (registered) runCatching { manager.unregisterNetworkCallback(callback) } }
}
