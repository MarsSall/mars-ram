package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ResourceLeasesTest {
  private class Resource { var closes = 0 }
  private fun pool() = ResourceLeases<Resource, Resource>({ it.closes++ }, { it.closes++ })

  @Test fun releasingUiPreservesServiceConnectionAndForwards() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val service = pool.acquire(LeaseOwner.SERVICE)
    val client = Resource()
    val uiForward = Resource()
    val serviceForward = Resource()
    assertTrue(ui.publish("connection", client))
    assertTrue(service.retain("connection"))
    assertTrue(ui.publishForward("ui", "connection", client, uiForward))
    assertTrue(service.publishForward("service", "connection", client, serviceForward))
    ui.close()
    assertEquals(1, uiForward.closes)
    assertEquals(0, serviceForward.closes)
    assertEquals(0, client.closes)
    assertSame(client, service.connection("connection"))
    service.close()
    assertEquals(1, serviceForward.closes)
    assertEquals(1, client.closes)
    service.close()
    assertEquals(1, client.closes)
  }

  @Test fun serviceCannotAccessOrCloseUiResourcesWithoutRetaining() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val service = pool.acquire(LeaseOwner.SERVICE)
    val client = Resource()
    val forward = Resource()
    ui.publish("connection", client)
    ui.publishForward("ui", "connection", client, forward)
    assertNull(service.connection("connection"))
    service.disconnect("connection")
    service.closeForward("ui")
    service.close()
    assertEquals(0, client.closes)
    assertEquals(0, forward.closes)
    assertSame(client, ui.connection("connection"))
  }

  @Test fun separateUiAndServiceClientsHaveIndependentLifetimes() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val service = pool.acquire(LeaseOwner.SERVICE)
    val uiClient = Resource()
    val serviceClient = Resource()
    ui.publish("ui", uiClient)
    service.publish("service", serviceClient)
    ui.close()
    assertEquals(1, uiClient.closes)
    assertEquals(0, serviceClient.closes)
    assertSame(serviceClient, service.connection("service"))
    service.close()
    assertEquals(1, serviceClient.closes)
  }

  @Test fun twoUiInstancesDoNotShareOwnershipImplicitly() {
    val pool = pool()
    val first = pool.acquire(LeaseOwner.UI)
    val second = pool.acquire(LeaseOwner.UI)
    val client = Resource()
    first.publish("first", client)
    second.close()
    assertEquals(0, client.closes)
    assertSame(client, first.connection("first"))
  }

  @Test fun repeatedRetainDoesNotLeakAHoldAndStaleClientCannotPublishForward() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val service = pool.acquire(LeaseOwner.SERVICE)
    val client = Resource()
    val forward = Resource()
    ui.publish("connection", client)
    assertTrue(service.retain("connection"))
    assertTrue(service.retain("connection"))
    assertFalse(service.publishForward("stale", "connection", Resource(), forward))
    assertEquals(1, forward.closes)
    ui.close()
    service.close()
    assertEquals(1, client.closes)
  }

  @Test fun disconnectReleasesOnlyCallersHoldAndForwards() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val service = pool.acquire(LeaseOwner.SERVICE)
    val client = Resource()
    ui.publish("connection", client)
    service.retain("connection")
    service.disconnect("connection")
    assertNull(service.connection("connection"))
    assertSame(client, ui.connection("connection"))
    assertEquals(0, client.closes)
    ui.disconnect("connection")
    assertEquals(1, client.closes)
  }

  @Test fun lateConnectionAndForwardPublicationAreClosedAfterRelease() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    ui.close()
    val client = Resource()
    val forward = Resource()
    assertFalse(ui.publish("late", client))
    assertFalse(ui.publishForward("late", "late", client, forward))
    assertFalse(ui.retain("late"))
    assertEquals(1, client.closes)
    assertEquals(1, forward.closes)
  }

  @Test fun transportDropInvalidatesAllHoldersAndCallsTheirCallbacks() {
    val pool = pool()
    val detached = mutableListOf<String>()
    val ui = pool.acquire(LeaseOwner.UI) { detached.add("ui:$it") }
    val service = pool.acquire(LeaseOwner.SERVICE) { detached.add("service:$it") }
    val client = Resource()
    val forward = Resource()
    ui.publish("connection", client)
    service.retain("connection")
    service.publishForward("forward", "connection", client, forward)
    pool.drop("connection")
    pool.drop("connection")
    assertNull(ui.connection("connection"))
    assertNull(service.connection("connection"))
    assertEquals(setOf("ui:connection", "service:connection"), detached.toSet())
    assertEquals(2, detached.size)
    assertEquals(1, client.closes)
    assertEquals(1, forward.closes)
  }

  @Test fun closingConnectionRejectsAForwardOpenedConcurrently() {
    val pool = pool()
    val ui = pool.acquire(LeaseOwner.UI)
    val client = Resource()
    val forward = Resource()
    ui.publish("connection", client)
    val opened = CountDownLatch(1)
    val publish = CountDownLatch(1)
    val finished = CountDownLatch(1)
    var accepted = true
    val thread = Thread {
      opened.countDown()
      publish.await()
      accepted = ui.publishForward("forward", "connection", client, forward)
      finished.countDown()
    }
    thread.start()
    assertTrue(opened.await(5, TimeUnit.SECONDS))
    ui.close()
    publish.countDown()
    assertTrue(finished.await(5, TimeUnit.SECONDS))
    thread.join()
    assertFalse(accepted)
    assertEquals(1, forward.closes)
    assertEquals(1, client.closes)
  }
}
