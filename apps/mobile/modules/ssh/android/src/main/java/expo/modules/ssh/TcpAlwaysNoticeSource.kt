package expo.modules.ssh

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException

internal class AlwaysListenerUnavailable : IOException()

/** Blocking accept/read run only on IO. No SSH, keepalives, wake locks, polling or unbounded queue. */
internal class TcpAlwaysNoticeSource(private val vault: AlwaysNotifyVault, hosts: List<AlwaysWatchHost>, private val onListening: suspend () -> Unit = {}) : AlwaysNoticeSource {
  private val identities = hosts.associate { it.hostKeyId to it.hostId }
  private val lock = Any()
  private var closed = false
  private val servers = mutableSetOf<ServerSocket>()
  private val clients = mutableSetOf<Socket>()
  private val verifier = AlwaysNoticeVerifier(commit = { n, secret, now ->
    identities[n.hostKeyId]?.let { vault.acceptReplay(it, n.bridgeInstanceId, n.seq, n.sentAt, now, secret) } ?: false
  })
  init { require(validAlwaysWatchHosts(hosts)) }

  private fun addresses(): List<InetAddress> = try {
    NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().flatMap { network ->
      network.inetAddresses.toList().filter { alwaysBindCandidate(network.name, network.isUp, it.address) }
    }.distinctBy { it.hostAddress }.also { if (it.isEmpty() || it.size > 2) throw AlwaysListenerUnavailable() }
  } catch (_: Exception) { throw AlwaysListenerUnavailable() }

  override fun events(): Flow<SessionAlert> = channelFlow {
    try {
      val listening = withContext(Dispatchers.IO) {
        addresses().map { address ->
          val server = ServerSocket()
          synchronized(lock) { if (closed) { server.close(); throw IOException() }; servers.add(server) }
          try {
            // Never use a wildcard or a fallback LAN/loopback address.
            server.bind(InetSocketAddress(address, ALWAYS_NOTIFY_PORT), 4)
            server
          } catch (_: Exception) { throw AlwaysListenerUnavailable() }
        }
      }
      onListening()
      listening.forEach { server -> launch(Dispatchers.IO) {
        while (isActive) {
          val client = server.accept()
          val admitted = synchronized(lock) { if (closed) false else { clients.add(client); true } }
          if (!admitted) { client.close(); break }
          try {
            client.use { socket ->
              if (!alwaysTailnetAddress(socket.inetAddress.address)) return@use
              // Absolute read deadline, not an inactivity timeout a slow sender can keep resetting.
              val deadline = System.nanoTime() + 2_000_000_000L
              val bytes = readAlwaysNoticeLine(socket.getInputStream()) {
                val remaining = (deadline - System.nanoTime()) / 1_000_000L
                if (remaining <= 0) throw SocketTimeoutException()
                socket.soTimeout = remaining.coerceAtMost(2000).toInt().coerceAtLeast(1)
              } ?: return@use
              val notice = verifier.verify(bytes, System.currentTimeMillis()) { key -> identities[key]?.let { vault.secret(it) } } ?: return@use
              val hostId = identities[notice.hostKeyId] ?: return@use
              val kind = when (notice.kind) {
                "needs-answer" -> WatchNotice.NEEDS_RESPONSE
                "failed" -> WatchNotice.FAILED
                else -> WatchNotice.COMPLETED
              }
              send(SessionAlert(SessionKey(hostId, notice.bridgeInstanceId), notice.project, kind))
            }
          } catch (e: CancellationException) { throw e
          } catch (_: Exception) { /* Untrusted input, revoked secret or storage failure: drop without diagnostics. */
          } finally { synchronized(lock) { clients.remove(client) }; runCatching { client.close() } }
        }
      } }
      awaitCancellation()
    } finally { close() }
  }
  override fun close() {
    synchronized(lock) {
      closed = true
      servers.forEach { runCatching { it.close() } }; servers.clear()
      clients.forEach { runCatching { it.close() } }; clients.clear()
    }
  }
}
