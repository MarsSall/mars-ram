package expo.modules.ssh

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

class WatchConnectionTest {
  private val identity = ConnectionIdentity("pc", 22, "me", "pin", "key")

  @Test fun adoptsBeforeSigningAndSurvivesUiRelease() = runBlocking {
    var closed = 0
    val resources = ResourceLeases<String, String>({ closed++ }, {})
    val ui = resources.acquire(LeaseOwner.UI)
    val service = resources.acquire(LeaseOwner.SERVICE)
    ui.publish("live", "client", identity)
    val id = acquireWatchConnection(
      { service.retainMatching(identity) { true } },
      { error("must not sign an expired key") },
      { error("must not connect") },
    )
    ui.close()
    assertEquals("live", id)
    assertEquals("client", service.connection(id))
    assertEquals(0, closed)
    service.close()
    assertEquals(1, closed)
  }

  @Test fun lookupAndRetainAreAtomicWithConcurrentUiRelease() {
    var closed = 0
    val resources = ResourceLeases<String, String>({ closed++ }, {})
    val ui = resources.acquire(LeaseOwner.UI)
    val service = resources.acquire(LeaseOwner.SERVICE)
    ui.publish("live", "client", identity)
    val inspecting = CountDownLatch(1)
    val releaseStarted = CountDownLatch(1)
    val adoption = FutureTask<String?> {
      service.retainMatching(identity) {
        inspecting.countDown()
        check(releaseStarted.await(5, TimeUnit.SECONDS))
        true
      }
    }
    val release = FutureTask<Unit> {
      check(inspecting.await(5, TimeUnit.SECONDS))
      releaseStarted.countDown()
      ui.close()
    }
    Thread(adoption).start()
    Thread(release).start()
    assertEquals("live", adoption.get(5, TimeUnit.SECONDS))
    release.get(5, TimeUnit.SECONDS)
    assertEquals("client", service.connection("live"))
    assertEquals(0, closed)
    service.close()
    assertEquals(1, closed)
  }

  @Test fun mismatchesAndDeadTransportsNeverAdopt() {
    val resources = ResourceLeases<String, String>({}, {})
    val ui = resources.acquire(LeaseOwner.UI)
    val service = resources.acquire(LeaseOwner.SERVICE)
    ui.publish("live", "client", identity)
    for (other in listOf(identity.copy(host = "other"), identity.copy(port = 23), identity.copy(username = "other"), identity.copy(fingerprint = "other"), identity.copy(keyAlias = "old"))) {
      assertNull(service.retainMatching(other) { true })
    }
    assertNull(service.retainMatching(identity) { false })
    resources.drop("live")
    assertNull(service.retainMatching(identity) { true })
    service.close()
    assertNull(service.retainMatching(identity) { true })
  }

  @Test fun noMatchSignsBeforeConnectingAndUnlockStopsTheAttempt() = runBlocking {
    val calls = mutableListOf<String>()
    assertEquals("new", acquireWatchConnection({ null }, { calls.add("sign") }, { calls.add("connect"); "new" }))
    assertEquals(listOf("sign", "connect"), calls)
    calls.clear()
    try {
      acquireWatchConnection({ null }, { calls.add("NeedsUnlock"); throw IllegalStateException("locked") }, { calls.add("connect"); "new" })
      fail("locked key must stop")
    } catch (_: IllegalStateException) { }
    assertEquals(listOf("NeedsUnlock"), calls)
  }
}
