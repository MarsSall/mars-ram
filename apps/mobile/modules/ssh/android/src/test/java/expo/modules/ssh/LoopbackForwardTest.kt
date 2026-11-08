package expo.modules.ssh

import net.schmizz.sshj.SSHClient
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Closing a link can wait for the host, so it must never hold the forward's monitor. */
class LoopbackForwardTest {
  private class Link(private val block: Boolean = false) : Closeable {
    val closes = AtomicInteger()
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    override fun close() {
      closes.incrementAndGet()
      entered.countDown()
      if (block) check(release.await(10, TimeUnit.SECONDS))
    }
  }

  private fun forward() = LoopbackForward("c", SSHClient(), ServerSocket(0, 1, InetAddress.getLoopbackAddress()), 1, "127.0.0.1") {}

  @Test fun aBlockedLinkCloseLetsOtherCallersProceed() {
    val forward = forward()
    val slow = Link(block = true)
    val other = Link()
    assertTrue(forward.track(slow))
    assertTrue(forward.track(other))
    val closer = Thread { forward.close() }.apply { start() }
    try {
      assertTrue("close never reached the link", slow.entered.await(5, TimeUnit.SECONDS))
      val late = Link()
      val during = FutureTask {
        // A link accepted after close started is refused and closed at once.
        assertFalse(forward.track(late))
        forward.close()
      }
      Thread(during).start()
      during.get(2, TimeUnit.SECONDS)
      assertEquals(1, late.closes.get())
    } finally {
      slow.release.countDown()
      closer.join(10_000)
    }
    assertFalse(closer.isAlive)
    assertEquals(1, slow.closes.get())
    assertEquals(1, other.closes.get())
  }

  @Test fun aSecondCloseClosesNothingTwice() {
    val forward = forward()
    val link = Link()
    assertTrue(forward.track(link))
    forward.close()
    forward.close()
    assertEquals(1, link.closes.get())
    assertFalse(forward.track(Link()))
  }
}
