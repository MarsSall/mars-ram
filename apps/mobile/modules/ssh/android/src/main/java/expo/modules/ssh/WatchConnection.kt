package expo.modules.ssh

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import java.io.IOException

/** Configured endpoint and credentials, not a resolved address or a key's current auth window. */
internal data class ConnectionIdentity(
  val host: String, val port: Int, val username: String, val fingerprint: String, val keyAlias: String,
)

/** Adoption must precede even the prompt-free signing probe: a live transport needs no key use. */
internal suspend fun acquireWatchConnection(
  adopt: () -> String?,
  signWithoutPrompt: () -> Unit,
  connect: suspend () -> String,
): String {
  adopt()?.let { return it }
  signWithoutPrompt()
  return connect()
}

/** Wakes a host parked for an unlock when the visible UI connects to it. */
internal class UnlockResume {
  private val generation = MutableStateFlow(0L)
  fun mark(): Long = generation.value
  fun resume() = generation.update { it + 1 }
  suspend fun awaitAfter(mark: Long) { generation.first { it != mark } }
}

internal class WatchUnlockRequired : IOException()

/**
 * Per-host retry policy. An unlock-required attempt parks until the UI connects to this host and
 * then retries at once, adopting that live connection; a UI connect during the failing attempt
 * counts, so it is not lost. Every other failure keeps its own backoff and ignores UI connects.
 */
internal suspend fun superviseWatchHost(
  resume: UnlockResume,
  attempt: suspend (connected: () -> Unit) -> Unit,
  state: suspend (String) -> Unit,
  backoff: suspend (Long) -> Unit = { delay(it) },
) {
  var failures = 0
  while (currentCoroutineContext().isActive) {
    val mark = resume.mark()
    try {
      attempt { failures = 0 }
    } catch (e: CancellationException) { throw e
    } catch (_: WatchUnlockRequired) {
      if (resume.mark() == mark) {
        state("unlock-required")
        resume.awaitAfter(mark)
      }
      failures = 0
      continue
    } catch (_: Exception) {
      failures++
      if (failures >= 3) state("connection-lost")
    }
    backoff(if (failures >= 3) 30_000 else failures.coerceAtLeast(1) * 2_000L)
  }
}
