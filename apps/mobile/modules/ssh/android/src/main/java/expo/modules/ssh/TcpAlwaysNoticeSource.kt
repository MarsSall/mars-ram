package expo.modules.ssh

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException

internal class AlwaysListenerUnavailable : IOException()

/** Let a VPN switch settle (the address arrives after the network) before reading addresses again. */
private const val ALWAYS_REBIND_SETTLE_MS = 1_000L
private const val ALWAYS_REBIND_RETRY_MS = 2_000L
private const val ALWAYS_REBIND_RETRY_MAX_MS = 30_000L

/**
 * Blocking accept/read run only on IO. No SSH, keepalives, wake locks, polling or unbounded queue.
 * Listens on every address `bindings` returns; on `changes` (a VPN switch or new address) closes stale listeners and
 * opens new ones. `onNetworks` reports the listening set, empty while no eligible VPN address exists.
 */
internal class TcpAlwaysNoticeSource(
  private val vault: AlwaysNotifyVault,
  hosts: List<AlwaysWatchHost>,
  private val bindings: () -> List<AlwaysBinding>,
  private val changes: Flow<Unit>,
  private val onNetworks: suspend (List<AlwaysBinding>) -> Unit = {},
) : AlwaysNoticeSource {
  private val identities = hosts.associate { it.hostKeyId to it.hostId }
  private val lock = Any()
  private var closed = false
  private val servers = mutableSetOf<ServerSocket>()
  private val clients = AlwaysClients<ServerSocket, Socket> { it.close() }
  private val verifier = AlwaysNoticeVerifier(commit = { n, secret, now ->
    identities[n.hostKeyId]?.let { vault.acceptReplay(it, n.bridgeInstanceId, n.seq, n.sentAt, now, secret) } ?: false
  })
  init { require(validAlwaysWatchHosts(hosts)) }

  /** null when the address cannot be bound now (not assigned yet, or already gone). */
  private fun bind(binding: AlwaysBinding): ServerSocket? {
    val server = ServerSocket()
    synchronized(lock) { if (closed) { server.close(); throw IOException() }; servers.add(server) }
    return try {
      // Never use a wildcard or a fallback LAN/loopback address.
      server.bind(InetSocketAddress(InetAddress.getByAddress(binding.address), ALWAYS_NOTIFY_PORT), 4)
      clients.listen(server)
      server
    } catch (_: Exception) {
      release(server)
      null
    }
  }
  /** Also closes the client its listener admitted: a sender must not outlive the binding that admitted it. */
  private fun release(server: ServerSocket) {
    synchronized(lock) { servers.remove(server) }
    runCatching { server.close() }
    clients.retire(server)
  }

  override fun events(): Flow<SessionAlert> = channelFlow {
    val wake = Channel<Unit>(Channel.CONFLATED)
    val open = linkedMapOf<AlwaysBinding, ServerSocket>()

    suspend fun accept(server: ServerSocket, binding: AlwaysBinding) {
      while (currentCoroutineContext().isActive) {
        val client = try { server.accept() } catch (_: IOException) {
          // Closed as stale, or its network went away: drop it and let the refresh decide.
          release(server); wake.trySend(Unit); return
        }
        // Refused (and closed) when this listener was retired by a rebind or everything closed meanwhile.
        if (!clients.admit(server, client)) return
        try {
          client.use { socket ->
            if (!binding.admits(socket.inetAddress.address)) return@use
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
        } finally { clients.remove(client); runCatching { client.close() } }
      }
    }

    /** True when every eligible address is listening and no listener had failed since the last refresh. */
    suspend fun refresh(): Boolean {
      var complete = true
      open.entries.removeAll { (_, server) -> server.isClosed.also { if (it) complete = false } }
      val desired = withContext(Dispatchers.IO) { runCatching(bindings).getOrDefault(emptyList()) }
      val diff = alwaysRebind(open.keys, desired)
      diff.close.forEach { binding -> open.remove(binding)?.let { release(it) } }
      diff.open.forEach { binding ->
        val server = withContext(Dispatchers.IO) { bind(binding) }
        if (server == null) complete = false
        else { open[binding] = server; launch(Dispatchers.IO) { accept(server, binding) } }
      }
      return complete
    }

    try {
      var complete = refresh()
      // At start, as before: no eligible address is an error the app shows, not a silent wait.
      if (open.isEmpty()) throw AlwaysListenerUnavailable()
      onNetworks(open.keys.toList())
      launch { changes.collect { wake.trySend(Unit) } }
      var retry = ALWAYS_REBIND_RETRY_MS
      while (true) {
        // A failing bind retries with backoff; network changes during it are coalesced into that retry.
        if (complete) { wake.receive(); retry = ALWAYS_REBIND_RETRY_MS } else { delay(retry); retry = (retry * 2).coerceAtMost(ALWAYS_REBIND_RETRY_MAX_MS) }
        delay(ALWAYS_REBIND_SETTLE_MS)
        wake.tryReceive()
        complete = refresh()
        onNetworks(open.keys.toList())
      }
    } finally { close() }
  }
  override fun close() {
    synchronized(lock) {
      closed = true
      servers.forEach { runCatching { it.close() } }; servers.clear()
    }
    clients.closeAll()
  }
}
