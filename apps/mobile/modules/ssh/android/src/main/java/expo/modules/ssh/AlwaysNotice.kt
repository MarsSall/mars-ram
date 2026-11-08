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
