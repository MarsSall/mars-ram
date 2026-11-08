package expo.modules.ssh

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AppUpdateListeningTest {
  private class Calls(val registers: Boolean = true) {
    val log = mutableListOf<String>()
    fun listen(): Boolean { log += "listen"; return registers }
    fun stop() { log += "stop" }
  }

  @Test fun theListenerIsRegisteredBeforePlayIsAsked() = runBlocking {
    val calls = Calls()
    val result = listeningFirst(calls::listen, calls::stop, { calls.log += "query"; "downloading" }) { it == "downloading" }
    assertEquals("downloading", result)
    assertEquals(listOf("listen", "query"), calls.log)
  }

  @Test fun aListenerAddedForNothingRunningIsRemoved() = runBlocking {
    for (answer in listOf("none", "downloaded")) {
      val calls = Calls()
      assertEquals(answer, listeningFirst(calls::listen, calls::stop, { calls.log += "query"; answer }) { it == "downloading" })
      assertEquals(listOf("listen", "query", "stop"), calls.log)
    }
  }

  @Test fun aListenerThatWasAlreadyThereIsKept() = runBlocking {
    val calls = Calls(registers = false)
    listeningFirst(calls::listen, calls::stop, { calls.log += "query"; "none" }) { it == "downloading" }
    assertEquals(listOf("listen", "query"), calls.log)
  }

  @Test fun aFailingQueryRemovesTheNewListener() {
    val calls = Calls()
    assertThrows(IllegalStateException::class.java) {
      runBlocking { listeningFirst(calls::listen, calls::stop, { error("offline") }) { true } }
    }
    assertEquals(listOf("listen", "stop"), calls.log)
  }
}
