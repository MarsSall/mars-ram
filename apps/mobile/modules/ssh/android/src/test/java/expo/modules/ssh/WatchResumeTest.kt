package expo.modules.ssh

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class WatchResumeTest {
  private class Run(val resume: UnlockResume = UnlockResume()) {
    val attempts = Channel<Int>(Channel.UNLIMITED)
    val states = mutableListOf<String>()
    val delays = mutableListOf<Long>()
    var count = 0
  }

  private fun CoroutineScope.supervise(run: Run, backoff: suspend (Long) -> Unit = {}, attempt: suspend Run.(Int, () -> Unit) -> Unit) = launch {
    superviseWatchHost(run.resume, { connected ->
      val n = ++run.count
      run.attempts.send(n)
      run.attempt(n, connected)
    }, { run.states.add(it) }, { run.delays.add(it); backoff(it) })
  }

  private suspend fun Run.next() = withTimeout(2_000) { attempts.receive() }
  private suspend fun Run.none() { delay(100); assertNull(attempts.tryReceive().getOrNull()) }

  @Test fun unlockParksUntilTheUiConnectsThenRetriesAtOnce() = runBlocking {
    val run = Run()
    val job = supervise(run) { n, connected ->
      if (n == 1) throw WatchUnlockRequired()
      connected()
      awaitCancellation() // Adopted the UI's live connection and keeps watching.
    }
    assertEquals(1, run.next())
    run.none()
    assertEquals(listOf("unlock-required"), run.states)
    run.resume.resume()
    assertEquals(2, run.next())
    assertTrue(run.delays.isEmpty())
    job.cancelAndJoin()
  }

  @Test fun aUiConnectRacingTheUnlockFailureIsNotLost() = runBlocking {
    val run = Run()
    val job = supervise(run) { n, _ ->
      if (n == 1) { resume.resume(); throw WatchUnlockRequired() }
      awaitCancellation()
    }
    assertEquals(1, run.next())
    assertEquals(2, run.next())
    assertTrue(run.states.isEmpty())
    job.cancelAndJoin()
  }

  @Test fun otherFailuresKeepTheirBackoffAndIgnoreUiConnects() = runBlocking {
    val run = Run()
    val waiting = Channel<Unit>()
    val job = supervise(run, backoff = { waiting.receive() }) { _, _ -> throw IOException() }
    for (n in 1..3) {
      assertEquals(n, run.next())
      run.resume.resume()
      run.none() // A UI connect does not cut a connection-lost backoff short.
      waiting.send(Unit)
    }
    assertEquals(4, run.next())
    assertEquals(listOf("connection-lost"), run.states.distinct())
    assertEquals(listOf(2_000L, 4_000L, 30_000L), run.delays.take(3))
    job.cancelAndJoin()
  }

  @Test fun aResumeBeforeTheAttemptDoesNotWakeALaterUnlock() = runBlocking {
    val run = Run()
    run.resume.resume()
    val job = supervise(run) { _, _ -> throw WatchUnlockRequired() }
    assertEquals(1, run.next())
    run.none()
    assertEquals(listOf("unlock-required"), run.states)
    run.resume.resume()
    assertEquals(2, run.next())
    job.cancelAndJoin()
  }

  @Test fun aSuccessfulConnectionResetsTheFailureCount() = runBlocking {
    val run = Run()
    val job = supervise(run) { n, connected ->
      if (n == 2) connected()
      if (n < 4) throw IOException()
      awaitCancellation()
    }
    repeat(4) { run.next() }
    assertEquals(listOf(2_000L, 2_000L, 4_000L), run.delays)
    assertTrue(run.states.isEmpty())
    job.cancelAndJoin()
  }
}
