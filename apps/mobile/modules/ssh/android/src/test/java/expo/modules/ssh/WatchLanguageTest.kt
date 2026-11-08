package expo.modules.ssh

import org.junit.Assert.assertEquals
import org.junit.Test

class WatchLanguageTest {
  @Test fun startFromTheAppUsesItsLanguage() {
    assertEquals("es", watchLanguage(configLanguage = "es", current = "en", rearm = false))
    assertEquals("en", watchLanguage(configLanguage = "fr", current = "es", rearm = false))
  }
  @Test fun lifecycleRearmKeepsTheLatestAppLanguageNotTheArmedOne() {
    assertEquals("es", watchLanguage(configLanguage = "en", current = "es", rearm = true))
  }
}
