package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream

class VpnPairingTest {
  private fun ip(vararg parts: Int) = ByteArray(4) { parts[it].toByte() }
  private fun prefix(length: Int, vararg parts: Int) = Ipv4Prefix(ip(*parts), length)
  private fun reply(text: String, maxBytes: Int = MAX_PAIRING_RESPONSE_BYTES) =
    readHttpResponse(ByteArrayInputStream(text.toByteArray(Charsets.ISO_8859_1)), maxBytes)
  private fun ok(reply: HttpReply): HttpReply.Ok = reply as? HttpReply.Ok ?: throw AssertionError("expected Ok, got $reply")

  @Test fun acceptsOnlyDottedDecimalIpv4Literals() {
    assertArrayEquals(ip(10, 147, 17, 5), parseIpv4Literal("10.147.17.5"))
    assertArrayEquals(ip(255, 255, 255, 255), parseIpv4Literal("255.255.255.255"))
    for (text in listOf("devbox", "devbox.ts.net", "10.147.17", "10.147.17.5.1", "010.1.1.1", "256.1.1.1", "::1", "fe80::1", "10.147.17.5 ", "10.147.17.5\r\nX: y", "")) {
      assertNull(text, parseIpv4Literal(text))
    }
  }

  @Test fun prefixCoversItsSubnetOnlyAndNeverAsADefaultRoute() {
    assertTrue(prefixCovers(prefix(24, 10, 147, 17, 0), ip(10, 147, 17, 5)))
    assertTrue(prefixCovers(prefix(16, 10, 147, 0, 0), ip(10, 147, 200, 1)))
    assertTrue(prefixCovers(prefix(32, 10, 147, 17, 5), ip(10, 147, 17, 5)))
    assertFalse(prefixCovers(prefix(32, 10, 147, 17, 6), ip(10, 147, 17, 5)))
    assertFalse(prefixCovers(prefix(24, 10, 147, 18, 0), ip(10, 147, 17, 5)))
    assertFalse(prefixCovers(prefix(0, 0, 0, 0, 0), ip(10, 147, 17, 5)))
    assertFalse(prefixCovers(Ipv4Prefix(ByteArray(16), 24), ip(10, 147, 17, 5)))
  }

  @Test fun picksOnlyAVpnThatRoutesTheAddress() {
    val wifi = RoutedNetwork("wifi", vpn = false, prefixes = listOf(prefix(24, 10, 147, 17, 0)))
    val fullTunnel = RoutedNetwork("full-tunnel", vpn = true, prefixes = listOf(prefix(0, 0, 0, 0, 0), prefix(32, 10, 8, 0, 2)))
    val zeroTier = RoutedNetwork("zerotier", vpn = true, prefixes = listOf(prefix(24, 10, 147, 17, 0)))
    val routedOnly = RoutedNetwork("routed", vpn = true, prefixes = listOf(prefix(32, 172, 27, 0, 9), prefix(16, 10, 147, 0, 0)))
    assertEquals("zerotier", vpnFor(ip(10, 147, 17, 5), listOf(wifi, fullTunnel, zeroTier)))
    assertEquals("routed", vpnFor(ip(10, 147, 17, 5), listOf(wifi, routedOnly)))
    // Same subnet on Wi-Fi is a LAN, not ZeroTier; a default route accepts any VPN.
    assertNull(vpnFor(ip(10, 147, 17, 5), listOf(wifi, fullTunnel)))
    assertNull(vpnFor(ip(10, 147, 17, 5), emptyList<RoutedNetwork<String>>()))
  }

  @Test fun aMoreSpecificExclusionWinsOverTheVpnsRoute() {
    // A /16 through ZeroTier, but the computer's /24 (or the exact address) is excluded from the VPN.
    val excludedSubnet = RoutedNetwork("zt", vpn = true, prefixes = listOf(prefix(16, 10, 147, 0, 0)), excluded = listOf(prefix(24, 10, 147, 17, 0)))
    val excludedHost = RoutedNetwork("zt", vpn = true, prefixes = listOf(prefix(24, 10, 147, 17, 0)), excluded = listOf(prefix(32, 10, 147, 17, 5)))
    assertNull(vpnFor(ip(10, 147, 17, 5), listOf(excludedSubnet)))
    assertNull(vpnFor(ip(10, 147, 17, 5), listOf(excludedHost)))
    // An exclusion as specific as the reaching route also wins: never guess in the key's favor.
    assertNull(vpnFor(ip(10, 147, 17, 5), listOf(RoutedNetwork("zt", vpn = true, prefixes = listOf(prefix(24, 10, 147, 17, 0)), excluded = listOf(prefix(24, 10, 147, 17, 0))))))
    // Elsewhere in the /16, and next to the excluded host, the VPN still reaches.
    assertEquals("zt", vpnFor(ip(10, 147, 18, 5), listOf(excludedSubnet)))
    assertEquals("zt", vpnFor(ip(10, 147, 17, 6), listOf(excludedHost)))
    // A more specific reaching route beats a broader exclusion.
    val carveBack = RoutedNetwork("zt", vpn = true, prefixes = listOf(prefix(32, 10, 147, 17, 5)), excluded = listOf(prefix(16, 10, 147, 0, 0)))
    assertEquals("zt", vpnFor(ip(10, 147, 17, 5), listOf(carveBack)))
    // An excluded VPN does not stop another VPN that does reach the address.
    val other = RoutedNetwork("other", vpn = true, prefixes = listOf(prefix(24, 10, 147, 17, 0)))
    assertEquals("other", vpnFor(ip(10, 147, 17, 5), listOf(excludedHost, other)))
    // Only exclusions: nothing reaches.
    assertNull(vpnFor(ip(10, 147, 17, 5), listOf(RoutedNetwork("zt", vpn = true, prefixes = emptyList(), excluded = listOf(prefix(24, 10, 147, 17, 0))))))
  }

  @Test fun countsOnlyUnicastRoutesOnApi33AndRoutesWithAnInterfaceBefore() {
    assertTrue(routeReaches(33, unicastType = true, interfaceName = "tun0"))
    assertFalse(routeReaches(33, unicastType = false, interfaceName = "tun0"))
    assertFalse(routeReaches(34, unicastType = false, interfaceName = null))
    assertTrue(routeReaches(32, unicastType = false, interfaceName = "tun0"))
    assertFalse(routeReaches(32, unicastType = false, interfaceName = null))
    assertFalse(routeReaches(26, unicastType = true, interfaceName = null))
  }

  @Test fun theDeadlineIsAbsoluteAndCapped() {
    var now = 1_000L
    val deadline = PairingDeadline({ now }, 5_000)
    assertEquals(5_000, deadline.remainingMs())
    assertEquals(5_000, deadline.timeoutMs())
    assertEquals(3_000, deadline.timeoutMs(cap = 3_000))
    deadline.check()
    now += 4_999
    assertEquals(1, deadline.timeoutMs())
    assertFalse(deadline.expired())
    now += 1
    assertTrue(deadline.expired())
    // A socket timeout of 0 would wait forever: an expired deadline still gives 1 ms, and check() stops first.
    assertEquals(1, deadline.timeoutMs())
    try { deadline.check(); fail("expired deadline passed") } catch (_: java.net.SocketTimeoutException) {}
    assertEquals(MAX_PAIRING_WAIT_MS, PairingDeadline({ 0L }, Long.MAX_VALUE).remainingMs())
    assertTrue(PairingDeadline({ 0L }, -5).expired())
  }

  @Test fun theWatchdogUnblocksABlockedReadWhenTheDeadlinePasses() {
    // A loopback server that accepts and then never answers, like a computer stuck before its user decides.
    java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress()).use { server ->
      java.net.Socket(server.inetAddress, server.localPort).use { socket ->
        server.accept().use {
          val started = System.nanoTime()
          Watchdog(50) { socket.close() }.use { watchdog ->
            try {
              // No soTimeout: without the watchdog this read would block forever.
              readHttpResponse(socket.getInputStream())
              fail("read returned")
            } catch (_: java.io.IOException) {}
            assertTrue(watchdog.hasFired)
          }
          assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
        }
      }
    }
  }

  @Test fun aClosedWatchdogNeverFires() {
    var fired = false
    val watchdog = Watchdog(30) { fired = true }
    watchdog.close()
    Thread.sleep(100)
    assertFalse(fired)
    assertFalse(watchdog.hasFired)
  }

  @Test fun sendsExactlyOnePostToPair() {
    val body = """{"code":"c"}""".toByteArray()
    assertEquals(
      "POST /pair HTTP/1.1\r\nHost: 10.147.17.5:47123\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: 12\r\nConnection: close\r\n\r\n{\"code\":\"c\"}",
      String(pairingRequest("10.147.17.5", 47123, body), Charsets.UTF_8),
    )
  }

  @Test fun readsTheChunkedAnswerNodeSends() {
    // Recorded from Node 26: writeHead(...connection: close) then end(json).
    val node = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nconnection: close\r\nDate: Mon, 09 Nov 2026 23:40:05 GMT\r\nTransfer-Encoding: chunked\r\n\r\nb\r\n{\"ok\":true}\r\n0\r\n\r\n"
    val answer = ok(reply(node))
    assertEquals(200, answer.status)
    assertEquals("{\"ok\":true}", answer.body)
    assertEquals("ab", ok(reply("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1;x=y\r\na\r\n1\r\nb\r\n0\r\nTrailer: z\r\n\r\n")).body)
  }

  @Test fun readsContentLengthAndCloseDelimitedBodies() {
    val sized = ok(reply("HTTP/1.1 403 Forbidden\r\nContent-Length: 4\r\n\r\nnopeEXTRA"))
    assertEquals(403, sized.status)
    assertEquals("nope", sized.body)
    assertEquals("{}", ok(reply("HTTP/1.0 200 OK\r\nConnection: close\r\n\r\n{}")).body)
    assertEquals("", ok(reply("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")).body)
  }

  @Test fun returnsARedirectWithoutFollowingIt() {
    val redirect = ok(reply("HTTP/1.1 302 Found\r\nLocation: http://evil.example/\r\nContent-Length: 0\r\n\r\n"))
    assertEquals(302, redirect.status)
    assertEquals("", redirect.body)
  }

  @Test fun refusesAnAnswerLargerThan16KiB() {
    val big = "x".repeat(MAX_PAIRING_RESPONSE_BYTES)
    assertSame(HttpReply.Bad, reply("HTTP/1.1 200 OK\r\nContent-Length: ${big.length}\r\n\r\n$big"))
    assertSame(HttpReply.Bad, reply("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n$big"))
    assertSame(HttpReply.Bad, reply("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4000\r\n$big\r\n0\r\n\r\n"))
    // A complete answer that fits exactly is accepted.
    val head = "HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n"
    assertEquals("0123456789", ok(reply(head + "0123456789", maxBytes = head.length + 10)).body)
  }

  @Test fun stopsReadingAsSoonAsTheAnswerIsComplete() {
    // A server that keeps the socket open after a full answer must not hold the phone until the deadline.
    val stream = object : InputStream() {
      val bytes = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}".toByteArray()
      var at = 0
      override fun read(): Int = throw AssertionError("single-byte reads are not used")
      override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (at == bytes.size) throw AssertionError("read past a complete answer")
        val n = minOf(len, bytes.size - at); System.arraycopy(bytes, at, b, off, n); at += n; return n
      }
    }
    assertEquals("{}", ok(readHttpResponse(stream)).body)
  }

  @Test fun runsTheDeadlineCheckBeforeEveryRead() {
    var checks = 0
    val text = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}"
    val slow = object : InputStream() {
      var at = 0
      override fun read(): Int = if (at < text.length) text[at++].code else -1
      override fun read(b: ByteArray, off: Int, len: Int): Int { val c = read(); if (c < 0) return -1; b[off] = c.toByte(); return 1 }
    }
    assertEquals("{}", ok(readHttpResponse(slow) { checks++ }).body)
    assertEquals(text.length, checks)
    try {
      readHttpResponse(ByteArrayInputStream(ByteArray(0))) { throw java.net.SocketTimeoutException() }
      fail("deadline ignored")
    } catch (_: java.net.SocketTimeoutException) {}
  }

  @Test fun refusesMalformedOrAmbiguousAnswers() {
    for (text in listOf(
      "",
      "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n",
      "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n{}",
      "HTTP/2 200\r\n\r\n{}",
      "SSH-2.0-OpenSSH_9.6\r\n\r\n",
      "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}",
      "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n{}x",
      "HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n{}",
      "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n{}\r\n0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}XX0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n",
      "HTTP/1.1 200 OK\r\n folded: header\r\nContent-Length: 2\r\n\r\n{}",
      "HTTP/1.1 200 OK\r\nno-colon\r\nContent-Length: 2\r\n\r\n{}",
    )) assertSame(text, HttpReply.Bad, reply(text))
    val badUtf8 = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n".toByteArray() + byteArrayOf(0xC3.toByte(), 0x28)
    assertSame(HttpReply.Bad, readHttpResponse(ByteArrayInputStream(badUtf8)))
  }
}
