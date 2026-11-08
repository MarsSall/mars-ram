package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

/** Mirrors RegistryEntry + checkCompatibility, not the notification-extra transport policy. */
class WatchRegistrationTest {
  private fun entry(): Map<String, Any?> = mapOf(
    "protocolVersion" to "1.6", "bridgeInstanceId" to "bridge", "sessionId" to "session",
    "port" to 43123, "token" to "t".repeat(32), "pid" to 123, "cwd" to "/home/project", "startedAt" to 1234.5,
  )
  @Test fun acceptsCanonicalEntryAndAdditiveFields() {
    val decoded = decodeWatchRegistration(entry() + ("future" to listOf(1)))!!
    assertEquals("bridge", decoded.id)
    assertEquals(43123, decoded.port)
    assertEquals("1.6", decoded.protocolVersion)
    assertEquals("project", decoded.project)
  }
  @Test fun rejectsNonStringEnvelopeFieldsRatherThanCoercing() {
    for (field in listOf("bridgeInstanceId", "sessionId", "protocolVersion")) {
      for (value in listOf(123, true, listOf("x"), mapOf("x" to 1), null)) {
        assertNull("$field must be a string", decodeWatchRegistration(entry() + (field to value)))
      }
    }
  }
  @Test fun acceptsAllNonemptyIdsWithoutNotificationAllowlist() {
    for (id in listOf("with spaces", "folder/id?#%", "\n", "😀", "x".repeat(201))) {
      val decoded = decodeWatchRegistration(entry() + mapOf("bridgeInstanceId" to id, "sessionId" to id))
      assertEquals(id, decoded?.id)
      assertEquals(id, decoded?.sessionId)
    }
  }
  @Test fun requiresEverySchemaFieldAndRejectsNulls() {
    for (field in entry().keys) {
      assertNull("missing $field", decodeWatchRegistration(entry() - field))
      assertNull("null $field", decodeWatchRegistration(entry() + (field to null)))
    }
    assertNull(decodeWatchRegistration(null))
    assertNull(decodeWatchRegistration(listOf(entry())))
  }
  @Test fun enforcesStringAndNumberConstraints() {
    for ((field, values) in mapOf(
      "bridgeInstanceId" to listOf(""), "sessionId" to listOf(""),
      "port" to listOf(0, 65536, 1.5, "22", true, Double.NaN, Double.POSITIVE_INFINITY),
      "pid" to listOf(0, -1, 1.5, "1", true, Double.NaN, Double.POSITIVE_INFINITY),
      "token" to listOf("x".repeat(31), 123, true), "cwd" to listOf(123, false),
      "startedAt" to listOf("1", true, Double.NaN, Double.POSITIVE_INFINITY),
    )) for (value in values) assertNull("invalid $field", decodeWatchRegistration(entry() + (field to value)))
    for (port in listOf(1, 65535, 22.0)) assertNotNull(decodeWatchRegistration(entry() + ("port" to port)))
    assertNotNull(decodeWatchRegistration(entry() + mapOf("cwd" to "", "startedAt" to -0.5, "pid" to 1e100)))
    // Schema accepts any string of length >=32; HTTP header safety is a separate adapter concern.
    assertNotNull(decodeWatchRegistration(entry() + ("token" to ("t".repeat(32) + "\n"))))
  }
  @Test fun notificationBoundaryEncodingIsLosslessAndCannotCollideOnDelimiters() {
    for (id in listOf("with spaces", "folder/id?#%", "\n", "😀", "\uD800", "x".repeat(201))) {
      val encoded = notificationWatchId(id)
      assertTrue(encoded.all { it in "0123456789abcdef" })
      val decoded = encoded.chunked(4).map { it.toInt(16).toChar() }.joinToString("")
      assertEquals(id, decoded)
    }
    val first = "${notificationWatchId("a:b")}:${notificationWatchId("c")}"
    val second = "${notificationWatchId("a")}:${notificationWatchId("b:c")}"
    assertNotEquals(first, second)
  }

  @Test fun tokenMinimumCountsCodePointsLikeTheProtocol() {
    assertNull(decodeWatchRegistration(entry() + ("token" to "\uD83D\uDE00".repeat(16))))
    assertNotNull(decodeWatchRegistration(entry() + ("token" to "\uD83D\uDE00".repeat(32))))
  }
  @Test fun compatibilityMatchesCanonicalMajorCheck() {
    for (version in listOf("1.0", "1.7", "01.06", "0001.0005", "1." + "9".repeat(100))) {
      assertNotNull(version, decodeWatchRegistration(entry() + ("protocolVersion" to version)))
    }
    for (version in listOf("2.0", "0.1", "one", "1", "1.6.0", "1.-1", " 1.6", "1.6\n")) {
      assertNull(version, decodeWatchRegistration(entry() + ("protocolVersion" to version)))
    }
  }
}
