package expo.modules.ssh

import net.schmizz.sshj.SSHClient
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

/**
 * A tunnel from a port on the phone's 127.0.0.1 to a port on the host's own loopback address.
 * Unlike sshj's LocalPortForwarder, it tracks every accepted connection, so closing the tunnel
 * also cuts the connections already flowing through it.
 */
internal class LoopbackForward(
  val connectionId: String,
  private val ssh: SSHClient,
  private val socket: ServerSocket,
  private val remotePort: Int,
  private val remoteHost: String,
  private val onEnd: () -> Unit,
) {
  private val links: MutableSet<Closeable> = ConcurrentHashMap.newKeySet()
  @Volatile private var closed = false

  val localPort: Int get() = socket.localPort

  fun start() {
    Thread({ acceptLoop() }, "ssh-forward-$localPort").apply {
      isDaemon = true
      start()
    }
  }

  private fun acceptLoop() {
    try {
      while (!closed) {
        val client = socket.accept()
        if (closed) {
          runCatching { client.close() }
          break
        }
        link(client)
      }
    } catch (_: IOException) {
      // The listening socket was closed or failed; either way the tunnel ends.
    } finally {
      close()
      onEnd()
    }
  }

  private fun link(client: Socket) {
    // Register the client before opening the channel, so a close while the channel opens
    // cuts the client at once instead of after the open completes or fails.
    // Atomic, so a close on another thread sees a channel opened by this thread.
    val channel = AtomicReference<Closeable?>(null)
    // The phone-side socket closes first: it is instant, while the channel may wait for the host.
    val link = Closeable {
      runCatching { client.close() }
      runCatching { channel.get()?.close() }
    }
    if (!track(link)) return
    val opened = try {
      ssh.newDirectConnection(remoteHost, remotePort)
    } catch (_: IOException) {
      link.close()
      links.remove(link)
      return
    }
    channel.set(opened)
    // Re-check after publishing, so a close that ran meanwhile still closes the new channel.
    if (closed) {
      link.close()
      links.remove(link)
      return
    }
    pump(client.getInputStream(), opened.outputStream, link)
    pump(opened.inputStream, client.getOutputStream(), link)
  }

  /** Copies one direction, flushing each chunk; when either side ends, the whole link closes. */
  private fun pump(from: InputStream, to: OutputStream, link: Closeable) {
    Thread({
      try {
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          val read = from.read(buffer)
          if (read < 0) break
          to.write(buffer, 0, read)
          to.flush()
        }
      } catch (_: IOException) {
        // A closed or failed side ends the link.
      } finally {
        link.close()
        links.remove(link)
      }
    }, "ssh-forward-$localPort-pump").apply {
      isDaemon = true
      start()
    }
  }

  /**
   * Registers a link, or closes it when the forward is already closing. Registration and
   * close's collection share the monitor, so every link is either collected or refused.
   */
  internal fun track(link: Closeable): Boolean {
    val accepted = synchronized(this) { if (!closed) links.add(link); !closed }
    if (!accepted) runCatching { link.close() }
    return accepted
  }

  /**
   * The monitor guards only the closed flag and link collection: closing a channel can wait
   * for the host, so it runs after release. A second caller returns at once.
   */
  fun close() {
    val closing = synchronized(this) {
      if (closed) return
      closed = true
      links.toList().also { links.clear() }
    }
    runCatching { socket.close() }
    closing.forEach { runCatching { it.close() } }
  }

  private companion object {
    const val BUFFER_BYTES = 16 * 1024
  }
}
