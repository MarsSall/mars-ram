package expo.modules.ssh

import android.util.Base64
import net.schmizz.sshj.connection.channel.direct.SessionChannel
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** One exec PTY. Terminal content is never logged or included in errors. */
internal class InteractiveTerminal(
  val connectionId: String,
  private val channel: SessionChannel,
  private val onOutput: (String) -> Unit,
  private val onExit: (Int?, String) -> Unit,
) {
  private val closed = AtomicBoolean(false)
  private val emission = Any()
  private val writes = Any()
  private var reader: Thread? = null

  fun start() {
    reader = Thread({ readLoop() }, "ssh-terminal-reader").apply { isDaemon = true; start() }
  }

  fun write(bytes: ByteArray) = synchronized(writes) {
    check(!closed.get())
    channel.outputStream.write(bytes)
    channel.outputStream.flush()
  }

  fun resize(cols: Int, rows: Int) {
    check(!closed.get())
    channel.changeWindowDimensions(cols, rows, 0, 0)
  }

  private fun readLoop() {
    try {
      val buffer = ByteArray(MAX_EVENT_BYTES)
      val streams = listOf(channel.inputStream, channel.errorStream)
      while (!closed.get()) {
        val batch = ByteArrayOutputStream(MAX_EVENT_BYTES)
        // Read only available bytes: idle terminals do not hit the connection's read timeout.
        // Drain extended data too, so a server's stderr cannot exhaust the shared SSH window.
        for (stream in streams) {
          while (batch.size() < MAX_EVENT_BYTES) {
            val available = stream.available()
            if (available <= 0) break
            val n = stream.read(buffer, 0, minOf(available, MAX_EVENT_BYTES - batch.size()))
            if (n <= 0) break // No-progress reads never spin.
            batch.write(buffer, 0, n)
          }
        }
        if (batch.size() > 0) synchronized(emission) {
          if (!closed.get()) onOutput(Base64.encodeToString(batch.toByteArray(), Base64.NO_WRAP))
        }
        if ((!channel.isOpen || channel.isEOF) && streams.all { it.available() == 0 }) {
          // EOF can precede exit-status and CHANNEL_CLOSE; allow a bounded wait for status.
          channel.join(1, TimeUnit.SECONDS)
          close("exited")
          return
        }
        // At most one 32 KiB event per 16 ms, with no idle busy-loop.
        Thread.sleep(16)
      }
    } catch (_: InterruptedException) {
      // Explicit close interrupts idle waits.
    } catch (_: Exception) {
      close("channel_closed")
    } finally {
      close("channel_closed")
    }
  }

  /** Exactly one exit; close unblocks readers and interrupts their bounded idle waits. */
  fun close(reason: String) {
    synchronized(emission) {
      if (!closed.compareAndSet(false, true)) return
      // JS may already be gone on module destruction; cleanup must still complete.
      runCatching { onExit(channel.exitStatus, reason) }
    }
    reader?.interrupt()
    runCatching { channel.close() }
  }

  private companion object { const val MAX_EVENT_BYTES = 32 * 1024 }
}
