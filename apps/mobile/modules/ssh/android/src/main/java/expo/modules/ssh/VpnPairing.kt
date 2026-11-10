package expo.modules.ssh

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.RouteInfo
import android.os.Build
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.atomic.AtomicBoolean

// ZeroTier pairing (odd/tasks/zerotier.md S4). Android allows cleartext only to ts.net names, so instead of
// opening cleartext app-wide this one request goes over a raw socket, like `probe`: POST /pair to exactly the
// QR's IPv4 address and pair port, only through an active VPN that routes that address, with bounded size and time.

internal const val MAX_PAIRING_RESPONSE_BYTES = 16 * 1024
internal const val MAX_PAIRING_BODY_BYTES = 4 * 1024
/** The computer's code lasts five minutes; never wait longer than this, whatever the QR says. */
internal const val MAX_PAIRING_WAIT_MS = 10 * 60_000L
private const val PAIRING_CONNECT_TIMEOUT_MS = 10_000L

private val IPV4_LITERAL = Regex("^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$")

/** Dotted-decimal IPv4 without leading zeros, as the offer carries it; null for names, IPv6 or anything else. */
internal fun parseIpv4Literal(text: String): ByteArray? =
  if (!IPV4_LITERAL.matches(text)) null else text.split('.').map { it.toInt().toByte() }.toByteArray()

internal class Ipv4Prefix(val address: ByteArray, val length: Int)

private fun ipv4Int(bytes: ByteArray): Int =
  ((bytes[0].toInt() and 0xff) shl 24) or ((bytes[1].toInt() and 0xff) shl 16) or ((bytes[2].toInt() and 0xff) shl 8) or (bytes[3].toInt() and 0xff)

/** A default route (/0) never counts: it would accept any full-tunnel VPN, not the network that has the computer. */
internal fun prefixCovers(prefix: Ipv4Prefix, address: ByteArray): Boolean {
  if (prefix.address.size != 4 || address.size != 4 || prefix.length !in 1..32) return false
  val mask = -1 shl (32 - prefix.length)
  return (ipv4Int(prefix.address) and mask) == (ipv4Int(address) and mask)
}

/**
 * One network as the route check sees it: whether it is a VPN, the IPv4 interface subnets and unicast routes that
 * reach through it, and the routes that do not (throw, unreachable, or excluded from the VPN).
 */
internal class RoutedNetwork<N>(val network: N, val vpn: Boolean, val prefixes: List<Ipv4Prefix>, val excluded: List<Ipv4Prefix> = emptyList())

/** Longest-prefix match over this network's routes; an exclusion as specific as the best reaching route wins. */
internal fun reaches(address: ByteArray, network: RoutedNetwork<*>): Boolean {
  val best = network.prefixes.filter { prefixCovers(it, address) }.maxOfOrNull { it.length } ?: return false
  val excludedBy = network.excluded.filter { prefixCovers(it, address) }.maxOfOrNull { it.length } ?: return true
  return excludedBy < best
}

/** The VPN whose own subnet or a specific route covers the address, or null when no VPN reaches it. */
internal fun <N> vpnFor(address: ByteArray, networks: List<RoutedNetwork<N>>): N? =
  networks.firstOrNull { it.vpn && reaches(address, it) }?.network

/**
 * Whether a route carries traffic out of its interface. API 33+ (where VPNs can exclude routes) knows its type;
 * before that, a route without an interface does not reach anything through this network.
 */
internal fun routeReaches(sdkInt: Int, unicastType: Boolean, interfaceName: String?): Boolean =
  if (sdkInt >= 33) unicastType else interfaceName != null

/** One absolute deadline on a monotonic clock, so a wall-clock change can neither extend nor cut the wait. */
internal class PairingDeadline(private val clock: () -> Long, timeoutMs: Long) {
  private val end = clock() + timeoutMs.coerceIn(0, MAX_PAIRING_WAIT_MS)
  fun remainingMs(): Long = end - clock()
  fun expired(): Boolean = remainingMs() <= 0
  /** Between stages: throws once the deadline passed, so the next blocking call never starts. */
  fun check() {
    if (expired()) throw SocketTimeoutException()
  }
  /** A socket timeout that ends no later than the deadline; at least 1 ms, since 0 means wait forever. */
  fun timeoutMs(cap: Long = Long.MAX_VALUE): Int = minOf(cap, remainingMs()).coerceIn(1, Int.MAX_VALUE.toLong()).toInt()
}

/**
 * Runs onExpire once after delayMs unless closed first. Socket timeouts do not bound a blocking write, so the
 * pairing request closes its socket from here, which unblocks connect, write and read alike.
 */
internal class Watchdog(delayMs: Long, private val onExpire: () -> Unit) : AutoCloseable {
  private val fired = AtomicBoolean(false)
  private val timer = Timer("vpn-pairing-deadline", true)
  init {
    timer.schedule(object : TimerTask() {
      override fun run() {
        fired.set(true)
        runCatching(onExpire)
      }
    }, delayMs.coerceAtLeast(0))
  }
  val hasFired: Boolean get() = fired.get()
  override fun close() = timer.cancel()
}

/** The address is a validated IPv4 literal, so no header can be injected through it. */
internal fun pairingRequest(address: String, port: Int, body: ByteArray): ByteArray =
  ("POST /pair HTTP/1.1\r\nHost: $address:$port\r\nContent-Type: application/json\r\nAccept: application/json\r\n" +
    "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII) + body

internal sealed class HttpReply {
  class Ok(val status: Int, val body: String) : HttpReply()
  object Bad : HttpReply()
}

private val CRLF = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte())
private val HEADER_END = CRLF + CRLF
private val STATUS_LINE = Regex("^HTTP/1\\.[01] ([0-9]{3})(?: [\\x20-\\x7E\\t]*)?$")
private val CONTENT_LENGTH = Regex("^[0-9]{1,9}$")
private val CHUNK_SIZE = Regex("^[0-9A-Fa-f]{1,6}$")

private fun indexOf(bytes: ByteArray, length: Int, needle: ByteArray, from: Int): Int {
  var at = maxOf(from, 0)
  while (at + needle.size <= length) {
    if (needle.indices.all { bytes[at + it] == needle[it] }) return at
    at++
  }
  return -1
}

private fun strictUtf8(bytes: ByteArray): String? = try {
  Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    .decode(ByteBuffer.wrap(bytes)).toString()
} catch (_: CharacterCodingException) {
  null
}

private sealed class Chunks {
  object Incomplete : Chunks()
  object Bad : Chunks()
  class Done(val body: ByteArray) : Chunks()
}

/** Node's pairing endpoint answers chunked; chunk extensions and trailers are skipped, never interpreted. */
private fun decodeChunked(bytes: ByteArray, start: Int, length: Int): Chunks {
  val out = ByteArrayOutputStream()
  var at = start
  while (true) {
    val lineEnd = indexOf(bytes, length, CRLF, at)
    if (lineEnd < 0) return Chunks.Incomplete
    val sizeText = String(bytes, at, lineEnd - at, Charsets.ISO_8859_1).substringBefore(';').trim()
    if (!CHUNK_SIZE.matches(sizeText)) return Chunks.Bad
    val size = sizeText.toInt(16)
    at = lineEnd + 2
    if (size == 0) return if (indexOf(bytes, length, HEADER_END, at - 2) < 0) Chunks.Incomplete else Chunks.Done(out.toByteArray())
    if (at + size + 2 > length) return Chunks.Incomplete
    if (bytes[at + size] != CRLF[0] || bytes[at + size + 1] != CRLF[1]) return Chunks.Bad
    out.write(bytes, at, size)
    at += size + 2
  }
}

/**
 * Reads one HTTP/1.x response from the first `length` bytes; null while more bytes are needed.
 * Only a final status (no 1xx), Content-Length, chunked, or close-delimited bodies; redirects are returned, never followed.
 */
internal fun parseHttpResponse(bytes: ByteArray, length: Int, eof: Boolean): HttpReply? {
  val headerEnd = indexOf(bytes, length, HEADER_END, 0)
  if (headerEnd < 0) return if (eof) HttpReply.Bad else null
  val lines = String(bytes, 0, headerEnd, Charsets.ISO_8859_1).split("\r\n")
  val status = STATUS_LINE.matchEntire(lines[0])?.groupValues?.get(1)?.toInt() ?: return HttpReply.Bad
  // The phone never sends Expect, so an interim answer is not the computer's.
  if (status < 200) return HttpReply.Bad
  var contentLength: Int? = null
  var chunked = false
  for (line in lines.drop(1)) {
    val colon = line.indexOf(':')
    if (colon <= 0 || line[0] == ' ' || line[0] == '\t') return HttpReply.Bad
    val value = line.substring(colon + 1).trim()
    when (line.substring(0, colon).lowercase()) {
      "content-length" -> {
        if (!CONTENT_LENGTH.matches(value) || (contentLength != null && contentLength != value.toInt())) return HttpReply.Bad
        contentLength = value.toInt()
      }
      "transfer-encoding" -> if (value.equals("chunked", ignoreCase = true)) chunked = true else return HttpReply.Bad
    }
  }
  if (chunked && contentLength != null) return HttpReply.Bad
  val start = headerEnd + HEADER_END.size
  val body = when {
    chunked -> when (val chunks = decodeChunked(bytes, start, length)) {
      is Chunks.Done -> chunks.body
      Chunks.Incomplete -> return if (eof) HttpReply.Bad else null
      Chunks.Bad -> return HttpReply.Bad
    }
    contentLength != null -> if (length - start < contentLength) return (if (eof) HttpReply.Bad else null) else bytes.copyOfRange(start, start + contentLength)
    eof -> bytes.copyOfRange(start, length)
    else -> return null
  }
  return strictUtf8(body)?.let { HttpReply.Ok(status, it) } ?: HttpReply.Bad
}

/** Reads at most maxBytes; beforeRead runs before every blocking read so the caller can enforce its deadline. */
internal fun readHttpResponse(input: InputStream, maxBytes: Int = MAX_PAIRING_RESPONSE_BYTES, beforeRead: () -> Unit = {}): HttpReply {
  val buffer = ByteArray(maxBytes)
  var length = 0
  while (true) {
    parseHttpResponse(buffer, length, eof = false)?.let { return it }
    if (length == maxBytes) return HttpReply.Bad
    beforeRead()
    val read = input.read(buffer, length, maxBytes - length)
    if (read < 0) return parseHttpResponse(buffer, length, eof = true) ?: HttpReply.Bad
    length += read
  }
}

/** Every network visible to this app with its IPv4 subnets and routes; a VPN shows only when it covers the app. */
private fun readRoutedNetworks(context: Context): List<RoutedNetwork<Network>> {
  val manager = context.getSystemService(ConnectivityManager::class.java) ?: return emptyList()
  @Suppress("DEPRECATION") val networks = manager.allNetworks
  return networks.mapNotNull { network ->
    val capabilities = manager.getNetworkCapabilities(network) ?: return@mapNotNull null
    val link = manager.getLinkProperties(network) ?: return@mapNotNull null
    val subnets = link.linkAddresses.mapNotNull { linkAddress ->
      (linkAddress.address as? Inet4Address)?.let { Ipv4Prefix(it.address, linkAddress.prefixLength) }
    }
    val (reaching, excluded) = link.routes.mapNotNull { route ->
      val destination = route.destination
      val unicast = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && route.type == RouteInfo.RTN_UNICAST
      (destination.address as? Inet4Address)?.let { Ipv4Prefix(it.address, destination.prefixLength) to routeReaches(Build.VERSION.SDK_INT, unicast, route.`interface`) }
    }.partition { it.second }
    RoutedNetwork(network, capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN), subnets + reaching.map { it.first }, excluded.map { it.first })
  }
}

private fun pairingFailure(code: String) = mapOf("ok" to false, "code" to code)

/**
 * Refuses (INVALID_REQUEST) anything but an IPv4 literal, a valid port, a positive wait and a JSON body of at most
 * 4 KiB; refuses (NOT_ON_VPN) unless a VPN routes the address. The socket is bound to that VPN, so the key never
 * leaves over Wi-Fi or mobile data. One absolute monotonic deadline covers connect, send and the wait for the user's
 * answer: checked between stages, applied to every socket timeout, and enforced by a watchdog that closes the socket.
 * Every failure resolves as a result; nothing is thrown to JavaScript.
 */
internal fun postPairingOverVpn(context: Context, address: String, port: Int, body: String, timeoutMs: Long): Map<String, Any> {
  val bytes = body.toByteArray(Charsets.UTF_8)
  val ip = parseIpv4Literal(address)
  if (ip == null || port !in 1..65535 || timeoutMs <= 0 || bytes.isEmpty() || bytes.size > MAX_PAIRING_BODY_BYTES) return pairingFailure("INVALID_REQUEST")
  val network = vpnFor(ip, runCatching { readRoutedNetworks(context) }.getOrDefault(emptyList())) ?: return pairingFailure("NOT_ON_VPN")
  val deadline = PairingDeadline(SystemClock::elapsedRealtime, timeoutMs)
  var watchdog: Watchdog? = null
  return try {
    Socket().use { socket ->
      watchdog = Watchdog(deadline.remainingMs()) { runCatching { socket.close() } }
      network.bindSocket(socket)
      deadline.check()
      socket.connect(InetSocketAddress(InetAddress.getByAddress(ip), port), deadline.timeoutMs(PAIRING_CONNECT_TIMEOUT_MS))
      deadline.check()
      socket.getOutputStream().apply { write(pairingRequest(address, port, bytes)); flush() }
      deadline.check()
      val reply = readHttpResponse(socket.getInputStream()) {
        deadline.check()
        socket.soTimeout = deadline.timeoutMs()
      }
      when (reply) {
        is HttpReply.Ok -> mapOf("ok" to true, "status" to reply.status, "body" to reply.body)
        HttpReply.Bad -> pairingFailure("BAD_RESPONSE")
      }
    }
  } catch (error: Exception) {
    // A socket the watchdog closed fails with a plain SocketException; it still means the time ran out.
    pairingFailure(if (error is SocketTimeoutException || watchdog?.hasFired == true || deadline.expired()) "TIMEOUT" else "UNREACHABLE")
  } finally {
    watchdog?.close()
  }
}
