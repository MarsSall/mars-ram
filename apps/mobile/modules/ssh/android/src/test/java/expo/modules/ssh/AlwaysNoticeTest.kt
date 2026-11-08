package expo.modules.ssh

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class AlwaysNoticeTest {
  private fun vector() = JSONObject(javaClass.classLoader!!.getResource("session-notice-v1.json")!!.readText())
  private fun line(): String = vector().let { it.getJSONObject("notice").put("mac", it.getString("mac")).toString() }
  private val now = 1800000000000L
  private val secret = ByteArray(32)
  @Test fun sharedVectorCanonicalAndMac() {
    val n = decodeAlwaysNotice(line().toByteArray())!!
    assertEquals(vector().getString("canonical"), canonicalAlwaysNotice(n))
    val verifier = AlwaysNoticeVerifier()
    assertNotNull(verifier.verify(line().toByteArray(), now) { secret })
    assertNull(verifier.verify(line().toByteArray(), now) { secret })
  }
  @Test fun rejectsUnauthenticatedBeforeUpdatingReplay() {
    val verifier = AlwaysNoticeVerifier()
    assertNull(verifier.verify(line().replace("demo", "other").toByteArray(), now) { secret })
    assertNull(verifier.verify(line().toByteArray(), now) { ByteArray(32) { 1 } })
    assertNull(verifier.verify(line().toByteArray(), now) { null })
    assertNotNull(verifier.verify(line().toByteArray(), now) { secret })
  }
  private fun signed(seq: Long = 7, sentAt: Long = now, instance: String = "bridge-1", project: String = "demo"): ByteArray {
    val json = JSONObject(line()).put("seq", seq).put("sentAt", sentAt).put("bridgeInstanceId", instance).put("project", project)
    val n = decodeAlwaysNotice(json.toString().toByteArray())!!
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(secret, "HmacSHA256")) }.doFinal(canonicalAlwaysNotice(n).toByteArray())
    return json.put("mac", mac.joinToString("") { "%02x".format(it.toInt() and 255) }).toString().toByteArray()
  }
  @Test fun boundsWindowInstanceAndReplayCapacity() {
    val verifier = AlwaysNoticeVerifier(2)
    assertNull(verifier.verify(signed(sentAt = now - 120001), now) { secret })
    assertNull(verifier.verify(signed(sentAt = now + 120001), now) { secret })
    assertNotNull(verifier.verify(signed(), now) { secret })
    assertNotNull(verifier.verify(signed(seq = 8, sentAt = now - 100000), now) { secret })
    assertNull(verifier.verify(signed(), now + 30000) { secret })
    assertNotNull(verifier.verify(signed(instance = "two"), now) { secret })
    assertNull(verifier.verify(signed(instance = "three"), now) { secret })
    assertNull(decodeAlwaysNotice(ByteArray(4097) { 32 }))
    assertNull(decodeAlwaysNotice(JSONObject(line()).put("project", "/private/demo").toString().toByteArray()))
    assertNull(decodeAlwaysNotice(JSONObject(line()).put("seq", "7").toString().toByteArray()))
    assertNull(decodeAlwaysNotice(JSONObject(line()).put("token", "private").toString().toByteArray()))
    assertNull(decodeAlwaysNotice(byteArrayOf(0xc3.toByte(), 0x28)))
  }
  @Test fun canonicalUnicodeAndEscapesMatchJsonStringify() {
    val bytes = signed(project = "á😀\"project")
    assertTrue(canonicalAlwaysNotice(decodeAlwaysNotice(bytes)!!).contains("á😀\\\"project"))
    assertNotNull(AlwaysNoticeVerifier().verify(bytes, now) { secret })
  }
  @Test fun boundedLineRequiresNewlineAndStopsAtOneFrame() {
    assertEquals("{}", readAlwaysNoticeLine("{}\nignored".byteInputStream())!!.toString(Charsets.UTF_8))
    assertNull(readAlwaysNoticeLine("{}".byteInputStream()))
    assertNull(readAlwaysNoticeLine(("x".repeat(4096) + "\n").byteInputStream()))
  }
  @Test fun durableReplayCommitRunsOnlyAfterAuthenticationAndMustSucceed() {
    var commits = 0
    val verifier = AlwaysNoticeVerifier(commit = { _, _, _ -> commits++; false })
    assertNull(verifier.verify(line().replace("demo", "other").toByteArray(), now) { secret })
    assertEquals(0, commits)
    assertNull(verifier.verify(line().toByteArray(), now) { secret })
    assertEquals(1, commits)
  }
  @Test fun concurrentDeliveryCommitsOnceAndWindowEdgesAreInclusive() {
    val verifier = AlwaysNoticeVerifier()
    val results = java.util.Collections.synchronizedList(mutableListOf<Boolean>())
    val gate = java.util.concurrent.CountDownLatch(1)
    val workers = (1..8).map { Thread { gate.await(); results.add(verifier.verify(line().toByteArray(), now) { secret } != null) }.apply { start() } }
    gate.countDown(); workers.forEach { it.join() }
    assertEquals(1, results.count { it })
    assertNotNull(AlwaysNoticeVerifier().verify(signed(sentAt = now - 120000), now) { secret })
    assertNotNull(AlwaysNoticeVerifier().verify(signed(sentAt = now + 120000), now) { secret })
  }
  @Test fun hostMappingsCannotAliasComputers() {
    assertTrue(validAlwaysWatchHosts(listOf(AlwaysWatchHost("one", "SHA256:one"))))
    assertFalse(validAlwaysWatchHosts(emptyList()))
    assertFalse(validAlwaysWatchHosts(listOf(AlwaysWatchHost("one", "SHA256:one"), AlwaysWatchHost("two", "SHA256:one"))))
    assertFalse(validAlwaysWatchHosts(listOf(AlwaysWatchHost("one", "SHA256:one"), AlwaysWatchHost("one", "SHA256:two"))))
  }
  @Test fun bindingAndPeersAreTailnetOnly() {
    assertTrue(alwaysTailnetAddress(byteArrayOf(100, 64, 0, 1)))
    assertTrue(alwaysTailnetAddress(byteArrayOf(100, 127, -1, -1)))
    assertFalse(alwaysTailnetAddress(byteArrayOf(100, 63, 0, 1)))
    assertFalse(alwaysTailnetAddress(byteArrayOf(127, 0, 0, 1)))
    val v6 = java.net.InetAddress.getByName("fd7a:115c:a1e0::1").address
    assertTrue(alwaysTailnetAddress(v6))
    assertFalse(alwaysTailnetAddress(java.net.InetAddress.getByName("fd7a:115c:a1e1::1").address))
    assertTrue(alwaysBindCandidate("tun0", true, v6))
    assertFalse(alwaysBindCandidate("wlan0", true, v6))
    assertFalse(alwaysBindCandidate("tun0", false, v6))
    assertFalse(alwaysBindCandidate("tun0", true, byteArrayOf(0, 0, 0, 0)))
  }
}
