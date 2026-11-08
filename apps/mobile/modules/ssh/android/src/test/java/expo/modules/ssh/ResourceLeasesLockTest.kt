package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** A blocking close (an SSH channel waiting for the host) must never hold the shared lock. */
class ResourceLeasesLockTest {
  private class Gate {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
  }
  private class Resource(val gate: Gate? = null) {
    @Volatile var closes = 0
    fun close() {
      closes++
      gate?.let { it.entered.countDown(); check(it.release.await(10, TimeUnit.SECONDS)) }
    }
  }
  private val identity = ConnectionIdentity("pc", 22, "me", "pin", "key")
  private fun pool() = ResourceLeases<Resource, Resource>({ it.close() }, { it.close() })

  /** Runs [closing] until it blocks in [gate], then requires [during] to finish on another thread. */
  private fun whileClosing(gate: Gate, closing: () -> Unit, during: () -> Unit) {
    val closer = Thread(closing).apply { start() }
    try {
      assertTrue("close never started", gate.entered.await(5, TimeUnit.SECONDS))
      val other = FutureTask { during() }
      Thread(other).start()
      other.get(2, TimeUnit.SECONDS)
    } finally {
      gate.release.countDown()
      closer.join(10_000)
    }
  }

  /** Every operation another caller (UI, service, isConnected) may need meanwhile. */
  private fun othersProceed(pool: ResourceLeases<Resource, Resource>, live: String, liveClient: Resource) {
    val other = pool.acquire(LeaseOwner.SERVICE)
    assertSame(liveClient, pool.acquire(LeaseOwner.UI).also { assertTrue(it.retain(live)) }.connection(live))
    assertEquals(live, other.retainMatching(identity) { true })
    assertSame(liveClient, other.connection(live))
    assertTrue(other.publish(java.util.UUID.randomUUID().toString(), Resource()))
  }

  @Test fun transportDropClosesForwardsAndClientOutsideTheLock() {
    for (blockForward in listOf(true, false)) {
      val pool = pool()
      val gate = Gate()
      val ui = pool.acquire(LeaseOwner.UI)
      val dead = Resource(gate.takeUnless { blockForward })
      val forward = Resource(gate.takeIf { blockForward })
      val live = Resource()
      ui.publish("dead", dead)
      ui.publish("live", live, identity)
      ui.publishForward("forward", "dead", dead, forward)
      whileClosing(gate, { pool.drop("dead") }) { othersProceed(pool, "live", live) }
      assertEquals(1, forward.closes)
      assertEquals(1, dead.closes)
      assertNull(ui.connection("dead"))
    }
  }

  @Test fun disconnectClosesForwardsAndClientOutsideTheLock() {
    for (blockForward in listOf(true, false)) {
      val pool = pool()
      val gate = Gate()
      val ui = pool.acquire(LeaseOwner.UI)
      val client = Resource(gate.takeUnless { blockForward })
      val forward = Resource(gate.takeIf { blockForward })
      val live = Resource()
      ui.publish("closing", client)
      ui.publish("live", live, identity)
      ui.publishForward("forward", "closing", client, forward)
      whileClosing(gate, { ui.disconnect("closing") }) { othersProceed(pool, "live", live) }
      assertEquals(1, forward.closes)
      assertEquals(1, client.closes)
    }
  }

  @Test fun detachCallbackRunsOutsideTheLock() {
    val pool = pool()
    val gate = Gate()
    // Like SshModule closing its terminals' channels when a connection detaches.
    val ui = pool.acquire(LeaseOwner.UI) { gate.entered.countDown(); check(gate.release.await(10, TimeUnit.SECONDS)) }
    val owner = pool.acquire(LeaseOwner.SERVICE)
    val live = Resource()
    ui.publish("closing", Resource())
    owner.publish("live", live, identity)
    whileClosing(gate, { ui.close() }) { othersProceed(pool, "live", live) }
  }

  @Test fun rejectedPublicationsAreDisposedOutsideTheLock() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val live = Resource()
    val client = Resource()
    ui.publish("live", live, identity)
    ui.publish("taken", client)
    val gate = Gate()
    val late = Resource(gate)
    whileClosing(gate, { assertFalse(ui.publish("taken", late)) }) { othersProceed(pool, "live", live) }
    assertEquals(1, late.closes)
    val forwardGate = Gate()
    val stale = Resource(forwardGate)
    whileClosing(forwardGate, { assertFalse(ui.publishForward("stale", "taken", Resource(), stale)) }) { othersProceed(pool, "live", live) }
    assertEquals(1, stale.closes)
  }

  @Test fun deadTransportIsRejectedAtPublicationAndDisposedOutsideTheLock() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val live = Resource()
    ui.publish("live", live, identity)
    val gate = Gate()
    val dead = Resource(gate)
    whileClosing(gate, { assertFalse(ui.publish("dead", dead, identity) { false }) }) { othersProceed(pool, "live", live) }
    assertEquals(1, dead.closes)
    assertNull(ui.connection("dead"))
  }

  @Test fun closingOneForwardDoesNotHoldTheLock() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val live = Resource()
    val gate = Gate()
    val forward = Resource(gate)
    ui.publish("live", live, identity)
    ui.publishForward("forward", "live", live, forward)
    whileClosing(gate, { ui.closeForward("forward") }) { othersProceed(pool, "live", live) }
    assertEquals(1, forward.closes)
    ui.closeForward("forward")
    assertEquals(1, forward.closes)
  }

  @Test fun lastHolderStillDisposesAfterTheLockIsReleased() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val service = pool.acquire(LeaseOwner.SERVICE)
    val client = Resource()
    val forward = Resource()
    ui.publish("connection", client)
    service.retain("connection")
    service.publishForward("forward", "connection", client, forward)
    ui.close()
    assertEquals(0, client.closes)
    service.close()
    assertEquals(1, forward.closes)
    assertEquals(1, client.closes)
  }
}
