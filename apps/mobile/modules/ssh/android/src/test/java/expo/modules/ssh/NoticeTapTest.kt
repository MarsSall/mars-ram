package expo.modules.ssh

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class NoticeTapTest {
  private val mark = "0123456789abcdef".repeat(4)

  private class MemoryStore(var value: String? = null) : NoticeTapStore {
    var writes = 0
    override fun read(): String? = value
    override fun write(value: String) { this.value = value; writes++ }
  }

  // React Native's Linking only reads intents with ACTION_VIEW, cold (getInitialURL) and warm (onNewIntent).
  @Test fun tapIsAViewIntentWithTheVariantSchemeLinkAndTheOwnMark() {
    val tap = noticeTap("com.marssall.marsram.preview", "0061", "0062", mark)
    assertEquals("android.intent.action.VIEW", tap.action)
    assertEquals("mars-ram-preview://notice?h=0061&b=0062&encoding=utf16-hex&t=$mark", tap.uri)
    assertEquals("mars-ram://notice?h=0061&b=0062&encoding=utf16-hex&t=$mark", noticeTap("com.marssall.marsram", "0061", "0062", mark).uri)
  }

  @Test fun tapRefusesAMalformedMark() {
    for (bad in listOf("", mark.uppercase(), mark.drop(1), "$mark&x=1")) {
      assertThrows(IllegalArgumentException::class.java) { noticeTap("com.marssall.marsram", "0061", "0062", bad) }
    }
  }

  @Test fun markIsCreatedOnceFrom32RandomBytesAndKept() {
    val store = MemoryStore()
    val tokens = NoticeTapTokens(store) { ByteArray(32) { it.toByte() } }
    val first = tokens.mark()
    assertEquals((0 until 32).joinToString("") { "%02x".format(it) }, first)
    assertEquals(first, tokens.mark())
    assertEquals(1, store.writes)
    assertNotEquals(first, NoticeTapTokens(MemoryStore()).mark())
  }

  @Test fun aCorruptStoredMarkIsReplaced() {
    val store = MemoryStore("not-a-mark")
    assertTrue(isNoticeTapMark(NoticeTapTokens(store).mark()))
    assertEquals(1, store.writes)
  }

  @Test fun acceptsOnlyTheStoredMark() {
    val tokens = NoticeTapTokens(MemoryStore(mark))
    assertTrue(tokens.accepts(mark))
    for (bad in listOf("", "f" + mark.drop(1), mark.uppercase(), mark.drop(1), mark + "0", "x".repeat(64))) assertFalse(bad, tokens.accepts(bad))
  }

  @Test fun acceptsNothingBeforeAnyNotificationAndNeverCreatesAMark() {
    val store = MemoryStore()
    assertFalse(NoticeTapTokens(store).accepts(mark))
    assertEquals(null, store.value)
    assertEquals(0, store.writes)
    assertFalse(NoticeTapTokens(MemoryStore("corrupt")).accepts("corrupt"))
  }
}
