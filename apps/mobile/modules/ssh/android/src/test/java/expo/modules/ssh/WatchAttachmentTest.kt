package expo.modules.ssh

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.Assert.*
import org.junit.Test

/** A UI connect resumes only hosts of the source actually running, by that source's configuration. */
class WatchAttachmentTest {
  private class Source : SessionEventSource {
    val unlocked = mutableListOf<String>()
    override fun configure(hosts: List<WatchHost>) {}
    override fun events(): Flow<WatchEvent> = emptyFlow()
    override fun unlocked(hostId: String) { unlocked.add(hostId) }
    override fun close() {}
  }
  private fun host(id: String, name: String) = WatchHost(id, name, null, 22, "me", "key", "SHA256:pin")
  private fun WatchAttachment.connect(name: String) = resume(name, 22, "me", "key", "SHA256:pin")?.let { (source, ids) ->
    ids.forEach { source.unlocked(it) }
    ids
  }.orEmpty()

  @Test fun resumesTheMatchingHostOfTheAttachedSource() {
    val attachment = WatchAttachment()
    val source = Source()
    attachment.attach(source, listOf(host("pc", "pc.tail"), host("mini", "mini.tail")))
    assertEquals(listOf("mini"), attachment.connect("mini.tail"))
    assertEquals(listOf("mini"), source.unlocked)
  }

  @Test fun aReconfigurationPendingAttachDoesNotTargetTheOldSource() {
    // The new configuration moved "pc" to another address, but the old source still runs.
    val attachment = WatchAttachment()
    val old = Source()
    attachment.attach(old, listOf(host("pc", "old.tail")))
    assertEquals(emptyList<String>(), attachment.connect("new.tail"))
    assertTrue(old.unlocked.isEmpty())
    val next = Source()
    attachment.attach(next, listOf(host("pc", "new.tail")))
    assertEquals(listOf("pc"), attachment.connect("new.tail"))
    assertEquals(listOf("pc"), next.unlocked)
    assertTrue(old.unlocked.isEmpty())
  }

  @Test fun aStaleDetachKeepsTheCurrentSourceAndADetachedOneIsIgnored() {
    val attachment = WatchAttachment()
    val old = Source()
    val next = Source()
    attachment.attach(old, listOf(host("pc", "pc.tail")))
    attachment.attach(next, listOf(host("pc", "pc.tail")))
    attachment.detach(old)
    assertEquals(listOf("pc"), attachment.connect("pc.tail"))
    attachment.detach(next)
    assertEquals(emptyList<String>(), attachment.connect("pc.tail"))
    assertTrue(old.unlocked.isEmpty())
    assertEquals(listOf("pc"), next.unlocked)
  }

  @Test fun everyConnectionFieldMustMatch() {
    val attachment = WatchAttachment()
    attachment.attach(Source(), listOf(host("pc", "pc.tail")))
    assertNull(attachment.resume("pc.tail", 2222, "me", "key", "SHA256:pin"))
    assertNull(attachment.resume("pc.tail", 22, "you", "key", "SHA256:pin"))
    assertNull(attachment.resume("pc.tail", 22, "me", "other", "SHA256:pin"))
    assertNull(attachment.resume("pc.tail", 22, "me", "key", "SHA256:other"))
    assertNull(attachment.resume("pc.tail", 22, "me", "key", null))
  }
}
