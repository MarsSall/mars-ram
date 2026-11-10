package expo.modules.ssh

import org.json.JSONObject
import org.json.JSONTokener
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

internal const val ALWAYS_NOTICE_BYTES = 4096
internal const val ALWAYS_WINDOW_MS = 120000L
internal const val ALWAYS_NOTIFY_PORT = 47812
// Not a data class: diagnostics must not accidentally stringify authenticated wire fields.
internal class AlwaysNotice(val hostKeyId: String, val bridgeInstanceId: String, val project: String,
  val kind: String, val seq: Long, val sentAt: Long, val nonce: String, val mac: ByteArray)

private fun noticeText(value: Any?, max: Int): String? {
  val text = value as? String ?: return null
  if (text.isEmpty() || text.length > max) return null
  var i = 0
  while (i < text.length) {
    val c = text[i]
    if (c.code < 32 || c.code in 127..159) return null
    if (c.isHighSurrogate()) { if (++i >= text.length || !text[i].isLowSurrogate()) return null }
    else if (c.isLowSurrogate()) return null
    i++
  }
  return text
}
private fun noticeInteger(value: Any?): Long? {
  val n = value as? Number ?: return null
  val number = n.toDouble()
  return if (number.isFinite() && number in 0.0..9007199254740991.0 && number == n.toLong().toDouble()) n.toLong() else null
}
internal fun decodeAlwaysNotice(bytes: ByteArray): AlwaysNotice? = try {
  if (bytes.size > ALWAYS_NOTICE_BYTES || bytes.isEmpty()) null else {
    val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    val parser = JSONTokener(text)
    val json = parser.nextValue() as? JSONObject ?: throw IllegalArgumentException()
    require(parser.nextClean() == '\u0000')
    require(json.keys().asSequence().toSet() == setOf("v", "hostKeyId", "bridgeInstanceId", "project", "kind", "seq", "sentAt", "nonce", "mac"))
    require(noticeInteger(json.opt("v")) == 1L)
    val host = noticeText(json.opt("hostKeyId"), 256) ?: throw IllegalArgumentException()
    val instance = noticeText(json.opt("bridgeInstanceId"), 256) ?: throw IllegalArgumentException()
    val project = noticeText(json.opt("project"), 200) ?: throw IllegalArgumentException()
    require(project != "." && project != ".." && '/' !in project && '\\' !in project)
    val kind = json.opt("kind") as? String ?: throw IllegalArgumentException()
    require(kind in setOf("finished", "needs-answer", "failed"))
    val seq = noticeInteger(json.opt("seq")) ?: throw IllegalArgumentException()
    val sentAt = noticeInteger(json.opt("sentAt")) ?: throw IllegalArgumentException()
    val nonce = json.opt("nonce") as? String ?: throw IllegalArgumentException()
    val mac = json.opt("mac") as? String ?: throw IllegalArgumentException()
    require(Regex("[a-f0-9]{32}").matches(nonce) && Regex("[a-f0-9]{64}").matches(mac))
    AlwaysNotice(host, instance, project, kind, seq, sentAt, nonce, mac.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
  }
} catch (_: Exception) { null }

/** JSON.stringify escaping for the already validated strings, including literal Unicode. */
private fun quoteNotice(text: String) = "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
internal fun canonicalAlwaysNotice(n: AlwaysNotice): String =
  "[1,${quoteNotice(n.hostKeyId)},${quoteNotice(n.bridgeInstanceId)},${quoteNotice(n.project)},${quoteNotice(n.kind)},${n.seq},${n.sentAt},${quoteNotice(n.nonce)}]"

/** Verification and cursor commit are atomic. Rejected MACs never allocate or advance replay state. */
internal class AlwaysNoticeVerifier(private val capacity: Int = 4096, private val commit: (AlwaysNotice, ByteArray, Long) -> Boolean = { _, _, _ -> true }) {
  private data class Cursor(val seq: Long, val expires: Long)
  private val cursors = mutableMapOf<Pair<String, String>, Cursor>()
  @Synchronized fun verify(bytes: ByteArray, now: Long, secretForHost: (String) -> ByteArray?): AlwaysNotice? {
    val n = decodeAlwaysNotice(bytes) ?: return null
    val secret = secretForHost(n.hostKeyId) ?: return null
    if (secret.size != 32) return null
    val expected = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(secret, "HmacSHA256")) }.doFinal(canonicalAlwaysNotice(n).toByteArray(Charsets.UTF_8))
    if (!MessageDigest.isEqual(expected, n.mac)) return null
    if (now < 0 || n.sentAt < now - ALWAYS_WINDOW_MS || n.sentAt > now + ALWAYS_WINDOW_MS) return null
    cursors.entries.removeAll { it.value.expires < now }
    val id = n.hostKeyId to n.bridgeInstanceId
    val previous = cursors[id]
    if (previous != null && n.seq <= previous.seq || previous == null && cursors.size >= capacity) return null
    if (!commit(n, secret, now)) return null
    cursors[id] = Cursor(n.seq, maxOf(previous?.expires ?: 0, n.sentAt + ALWAYS_WINDOW_MS))
    return n
  }
}
internal fun readAlwaysNoticeLine(input: java.io.InputStream, beforeRead: () -> Unit = {}): ByteArray? {
  val output = java.io.ByteArrayOutputStream()
  repeat(ALWAYS_NOTICE_BYTES) {
    beforeRead()
    val byte = input.read()
    if (byte < 0) return null
    if (byte == 10) return output.toByteArray()
    output.write(byte)
  }
  return null
}
internal fun alwaysTailnetAddress(bytes: ByteArray): Boolean = when (bytes.size) {
  4 -> (bytes[0].toInt() and 255) == 100 && (bytes[1].toInt() and 255) in 64..127
  16 -> bytes.take(6) == listOf(0xfd.toByte(), 0x7a.toByte(), 0x11.toByte(), 0x5c.toByte(), 0xa1.toByte(), 0xe0.toByte())
  else -> false
}
internal fun alwaysBindCandidate(name: String, up: Boolean, bytes: ByteArray) =
  up && Regex("tun[0-9]*").matches(name) && alwaysTailnetAddress(bytes)

// A non-Tailscale VPN (ZeroTier, odd/tasks/zerotier-phase2.md S4): the phone also listens on that VPN's own IPv4
// address and admits only senders inside its subnet. Shorter than /8 is too broad to mean one private network;
// /31 and /32 leave no other host to admit.
internal const val ALWAYS_VPN_MIN_PREFIX = 8
internal const val ALWAYS_VPN_MAX_PREFIX = 30
/** More VPN addresses than this is not one private network the user joined; listen on none of them. */
internal const val ALWAYS_VPN_MAX_ADDRESSES = 4

internal enum class AlwaysNetwork(val wire: String) { TAILSCALE("tailscale"), VPN("vpn") }

/** One listening address and the senders it admits. Equal when kind, address and prefix are equal. */
internal class AlwaysBinding(val network: AlwaysNetwork, val address: ByteArray, val prefix: Int) {
  val key: String get() = network.wire + "/" + address.joinToString(".") { (it.toInt() and 255).toString() } + "/" + prefix
  fun admits(peer: ByteArray): Boolean = when (network) {
    AlwaysNetwork.TAILSCALE -> alwaysTailnetAddress(peer)
    AlwaysNetwork.VPN -> alwaysVpnPeer(address, prefix, peer)
  }
  override fun equals(other: Any?) = other is AlwaysBinding && other.key == key
  override fun hashCode() = key.hashCode()
}

/** The Tailscale tun addresses, as before: more than two is not Tailscale's own interface. */
internal fun alwaysTailscaleBindings(addresses: List<ByteArray>): List<AlwaysBinding> {
  val distinct = addresses.distinctBy { it.toList() }
  if (distinct.size > 2) return emptyList()
  return distinct.map { AlwaysBinding(AlwaysNetwork.TAILSCALE, it, if (it.size == 4) 10 else 48) }
}

private fun ipv4Bits(bytes: ByteArray): Int =
  ((bytes[0].toInt() and 255) shl 24) or ((bytes[1].toInt() and 255) shl 16) or ((bytes[2].toInt() and 255) shl 8) or (bytes[3].toInt() and 255)
private fun ipv4Mask(prefix: Int): Int = if (prefix == 0) 0 else -1 shl (32 - prefix)

/** A unicast IPv4 host address inside a bounded subnet, outside Tailscale's range, never its network or broadcast. */
internal fun alwaysVpnBindCandidate(address: ByteArray, prefix: Int): Boolean {
  if (address.size != 4 || prefix !in ALWAYS_VPN_MIN_PREFIX..ALWAYS_VPN_MAX_PREFIX || isTailscaleAddress(address)) return false
  val first = address[0].toInt() and 255
  val second = address[1].toInt() and 255
  if (first == 0 || first == 127 || first >= 224 || (first == 169 && second == 254)) return false
  val host = ipv4Bits(address) and ipv4Mask(prefix).inv()
  return host != 0 && host != ipv4Mask(prefix).inv()
}

/** A sender on the listening address's subnet: not the phone itself, the network or the broadcast address. */
internal fun alwaysVpnPeer(own: ByteArray, prefix: Int, peer: ByteArray): Boolean {
  if (peer.size != 4 || !alwaysVpnBindCandidate(own, prefix) || peer.contentEquals(own)) return false
  val mask = ipv4Mask(prefix)
  val bits = ipv4Bits(peer)
  return (bits and mask) == (ipv4Bits(own) and mask) && (bits and mask.inv()) != 0 && (bits and mask.inv()) != mask.inv()
}

/** One IPv4 interface address as ConnectivityManager reports it, and whether its network is a VPN. */
internal class AlwaysLinkAddress(val vpn: Boolean, val address: ByteArray, val prefix: Int)

/**
 * Listening addresses on VPNs that are not Tailscale. Only VPN networks count, never Wi-Fi or mobile data; an address
 * a non-VPN network also carries is refused.
 */
internal fun alwaysVpnBindings(links: List<AlwaysLinkAddress>): List<AlwaysBinding> {
  val others = links.filter { !it.vpn }
  val eligible = links.filter { link ->
    link.vpn && alwaysVpnBindCandidate(link.address, link.prefix) && others.none { it.address.contentEquals(link.address) }
  }.map { AlwaysBinding(AlwaysNetwork.VPN, it.address, it.prefix) }.distinct()
  return if (eligible.size > ALWAYS_VPN_MAX_ADDRESSES) emptyList() else eligible
}

internal class AlwaysRebind(val close: List<AlwaysBinding>, val open: List<AlwaysBinding>)

/** Listeners to close (gone or changed) and to open; a changed prefix closes and reopens the same address. */
internal fun alwaysRebind(current: Collection<AlwaysBinding>, desired: Collection<AlwaysBinding>): AlwaysRebind {
  val want = desired.distinct()
  return AlwaysRebind(current.filter { it !in want }, want.filter { it !in current })
}

/** What the app shows per network; addresses are the phone's own, never a sender's. */
internal fun alwaysNetworksStatus(bindings: List<AlwaysBinding>): List<Map<String, Any>> = bindings.map {
  mapOf("kind" to it.network.wire, "address" to java.net.InetAddress.getByAddress(it.address).hostAddress.orEmpty(), "prefix" to it.prefix)
}

/**
 * Accepted senders by the listener that admitted them. Retiring a listener (rebind or loss) closes its senders, and a
 * sender it accepted just before is refused, so nothing admitted under a binding that no longer exists can notify.
 */
internal class AlwaysClients<S, C>(private val close: (C) -> Unit) {
  private val listeners = mutableSetOf<S>()
  private val clients = linkedMapOf<C, S>()
  private var closed = false
  @Synchronized fun listen(listener: S) { if (!closed) listeners.add(listener) }
  /** False (and the client closed) when its listener was retired or everything was closed. */
  @Synchronized fun admit(listener: S, client: C): Boolean {
    if (closed || listener !in listeners) { runCatching { close(client) }; return false }
    clients[client] = listener
    return true
  }
  @Synchronized fun remove(client: C) { clients.remove(client) }
  @Synchronized fun retire(listener: S) {
    listeners.remove(listener)
    val stale = clients.filterValues { owner -> owner == listener }.keys.toList()
    stale.forEach { client -> clients.remove(client); runCatching { close(client) } }
  }
  @Synchronized fun closeAll() {
    closed = true; listeners.clear()
    clients.keys.toList().forEach { client -> runCatching { close(client) } }; clients.clear()
  }
}
