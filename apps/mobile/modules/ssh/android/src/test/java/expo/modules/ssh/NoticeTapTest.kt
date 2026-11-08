package expo.modules.ssh

import org.junit.Assert.assertEquals
import org.junit.Test

class NoticeTapTest {
  // React Native's Linking only reads intents with ACTION_VIEW, cold (getInitialURL) and warm (onNewIntent).
  @Test fun tapIsAViewIntentWithTheVariantSchemeLink() {
    val tap = noticeTap("com.marssall.marsram.preview", "0061", "0062")
    assertEquals("android.intent.action.VIEW", tap.action)
    assertEquals("mars-ram-preview://notice?h=0061&b=0062&encoding=utf16-hex", tap.uri)
    assertEquals("mars-ram://notice?h=0061&b=0062&encoding=utf16-hex", noticeTap("com.marssall.marsram", "0061", "0062").uri)
  }
}
