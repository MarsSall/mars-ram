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
  private fun ip(text: String) = java.net.InetAddress.getByName(text).address
  @Test fun tailscaleBindingsKeepTheirRangeCheckAndLimit() {
    val v4 = ip("100.101.102.103")
    val v6 = ip("fd7a:115c:a1e0::1")
    val both = alwaysTailscaleBindings(listOf(v4, v6, v4.copyOf()))
    assertEquals(listOf("tailscale/100.101.102.103/10"), both.take(1).map { it.key })
    assertEquals(2, both.size)
    assertTrue(both[0].admits(ip("100.64.0.9")))
    assertFalse(both[0].admits(ip("10.147.20.49")))
    assertTrue(alwaysTailscaleBindings(listOf(v4, v6, ip("100.64.0.2"))).isEmpty())
  }
  @Test fun vpnAddressMustBeABoundedNonTailscaleHost() {
    assertTrue(alwaysVpnBindCandidate(ip("10.147.20.12"), 24))
    assertTrue(alwaysVpnBindCandidate(ip("10.147.20.12"), 8))
    assertTrue(alwaysVpnBindCandidate(ip("172.22.0.5"), 30))
    assertFalse(alwaysVpnBindCandidate(ip("10.147.20.12"), 0))
    assertFalse(alwaysVpnBindCandidate(ip("10.147.20.12"), 7))
    assertFalse(alwaysVpnBindCandidate(ip("10.147.20.12"), 31))
    assertFalse(alwaysVpnBindCandidate(ip("10.147.20.12"), 32))
    assertFalse(alwaysVpnBindCandidate(ip("100.101.102.103"), 24))
    assertFalse(alwaysVpnBindCandidate(ip("127.0.0.1"), 8))
    assertFalse(alwaysVpnBindCandidate(ip("169.254.3.4"), 16))
    assertFalse(alwaysVpnBindCandidate(ip("224.0.0.5"), 24))
    assertFalse(alwaysVpnBindCandidate(ip("0.1.2.3"), 8))
    assertFalse(alwaysVpnBindCandidate(ip("10.147.20.0"), 24))
    assertFalse(alwaysVpnBindCandidate(ip("10.147.20.255"), 24))
    assertFalse(alwaysVpnBindCandidate(ip("fd00::1"), 24))
  }
  @Test fun vpnPeersOnlyFromTheListeningSubnet() {
    val own = ip("10.147.20.12")
    assertTrue(alwaysVpnPeer(own, 24, ip("10.147.20.49")))
    assertFalse(alwaysVpnPeer(own, 24, ip("10.147.172.49")))
    assertFalse(alwaysVpnPeer(own, 24, ip("192.168.1.20")))
    assertFalse(alwaysVpnPeer(own, 24, ip("100.64.0.9")))
    assertFalse(alwaysVpnPeer(own, 24, own))
    assertFalse(alwaysVpnPeer(own, 24, ip("10.147.20.0")))
    assertFalse(alwaysVpnPeer(own, 24, ip("10.147.20.255")))
    assertFalse(alwaysVpnPeer(own, 24, ip("fd00::1")))
    assertTrue(alwaysVpnPeer(own, 16, ip("10.147.3.4")))
    assertFalse(alwaysVpnPeer(own, 0, ip("10.147.20.49")))
    assertFalse(alwaysVpnPeer(own, 4, ip("10.147.20.49")))
    val binding = AlwaysBinding(AlwaysNetwork.VPN, own, 24)
    assertTrue(binding.admits(ip("10.147.20.49")))
    assertFalse(binding.admits(ip("100.101.102.104")))
  }
  @Test fun vpnBindingsComeOnlyFromVpnNetworks() {
    val zt = AlwaysLinkAddress(true, ip("10.147.20.12"), 24)
    val wifi = AlwaysLinkAddress(false, ip("192.168.1.20"), 24)
    val tailscale = AlwaysLinkAddress(true, ip("100.101.102.103"), 32)
    assertEquals(listOf("vpn/10.147.20.12/24"), alwaysVpnBindings(listOf(wifi, zt, tailscale, zt)).map { it.key })
    assertTrue(alwaysVpnBindings(listOf(wifi, tailscale)).isEmpty())
    assertTrue(alwaysVpnBindings(listOf(AlwaysLinkAddress(true, ip("10.1.2.3"), 0))).isEmpty())
    assertTrue(alwaysVpnBindings(listOf(zt, AlwaysLinkAddress(false, ip("10.147.20.12"), 16))).isEmpty())
    val many = (1..5).map { AlwaysLinkAddress(true, byteArrayOf(10, it.toByte(), 0, 2), 24) }
    assertEquals(4, alwaysVpnBindings(many.take(4)).size)
    assertTrue(alwaysVpnBindings(many).isEmpty())
  }
  @Test fun rebindClosesStaleAndOpensNewListeners() {
    val tailscale = AlwaysBinding(AlwaysNetwork.TAILSCALE, ip("100.101.102.103"), 10)
    val zt = AlwaysBinding(AlwaysNetwork.VPN, ip("10.147.20.12"), 24)
    val ztWider = AlwaysBinding(AlwaysNetwork.VPN, ip("10.147.20.12"), 16)
    val switch = alwaysRebind(listOf(tailscale), listOf(zt))
    assertEquals(listOf(tailscale), switch.close)
    assertEquals(listOf(zt), switch.open)
    val same = alwaysRebind(listOf(zt), listOf(AlwaysBinding(AlwaysNetwork.VPN, ip("10.147.20.12"), 24)))
    assertTrue(same.close.isEmpty() && same.open.isEmpty())
    val prefix = alwaysRebind(listOf(zt), listOf(ztWider))
    assertEquals(listOf(zt), prefix.close)
    assertEquals(listOf(ztWider), prefix.open)
    val off = alwaysRebind(listOf(zt), emptyList())
    assertEquals(listOf(zt), off.close)
    assertTrue(off.open.isEmpty())
    assertEquals(listOf(zt), alwaysRebind(emptyList(), listOf(zt, zt)).open)
  }
  @Test fun rebindClosesClientsAdmittedByAClosedListener() {
    val closed = mutableListOf<String>()
    val clients = AlwaysClients<String, String> { closed += it }
    clients.listen("tailscale"); clients.listen("zerotier")
    assertTrue(clients.admit("tailscale", "a")); assertTrue(clients.admit("zerotier", "b"))
    clients.retire("tailscale")
    assertEquals(listOf("a"), closed)
    // A client accepted just before its listener was retired is refused and closed, never read.
    assertFalse(clients.admit("tailscale", "late")); assertEquals(listOf("a", "late"), closed)
    // A listener reopened on the same address is a new listener; the old one stays retired.
    clients.listen("tailscale-again"); assertTrue(clients.admit("tailscale-again", "c"))
    clients.remove("b"); clients.retire("zerotier"); assertEquals(listOf("a", "late"), closed)
    assertFalse(clients.admit("unknown", "d")); assertEquals(listOf("a", "late", "d"), closed)
    clients.closeAll(); assertEquals(listOf("a", "late", "d", "c"), closed)
    clients.listen("after"); assertFalse(clients.admit("after", "e")); assertEquals("e", closed.last())
  }
  @Test fun networksStatusShowsKindAddressAndPrefix() {
    val status = alwaysNetworksStatus(listOf(AlwaysBinding(AlwaysNetwork.VPN, ip("10.147.20.12"), 24), AlwaysBinding(AlwaysNetwork.TAILSCALE, ip("100.101.102.103"), 10)))
    assertEquals(listOf(mapOf("kind" to "vpn", "address" to "10.147.20.12", "prefix" to 24), mapOf("kind" to "tailscale", "address" to "100.101.102.103", "prefix" to 10)), status)
    assertEquals("PRIVATE_NETWORK_REQUIRED", alwaysRunningStatus(emptyList())["code"])
    assertEquals(emptyList<Any>(), alwaysRunningStatus(emptyList())["networks"])
    assertFalse(alwaysRunningStatus(listOf(AlwaysBinding(AlwaysNetwork.VPN, ip("10.147.20.12"), 24))).containsKey("code"))
  }
}
