package expo.modules.ssh

import kotlinx.coroutines.delay
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.transport.TransportException
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.keyprovider.KeyPairWrapper
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.security.KeyPair
import java.security.PublicKey
import java.util.UUID

internal typealias ConnectionLease = ResourceLeases<SSHClient, LoopbackForward>.Lease

/** Application-process SSH owner. No Activity, React context, terminal, or background service. */
internal object ConnectionManager {
  private const val CONNECT_TIMEOUT_MS = 10_000
  private const val NAME_RETRY_DELAY_MS = 1_500L
  private val resources = ResourceLeases<SSHClient, LoopbackForward>({ it.disconnect() }, { it.close() })
  /** Bookkeeping only: never close a client, forward, or channel while holding it. */
  internal val lifecycle: Any get() = resources.lock

  fun acquire(owner: LeaseOwner, onDetached: (String) -> Unit = {}): ConnectionLease = resources.acquire(owner, onDetached)

  /** Shares only an authenticated, pinned transport with exactly the configured identity. */
  fun adopt(lease: ConnectionLease, options: ConnectOptions): String? {
    val identity = identity(options) ?: return null
    return lease.retainMatching(identity) { it.isConnected && it.isAuthenticated }
  }

  private fun identity(options: ConnectOptions): ConnectionIdentity? = options.expectedFingerprint?.let {
    ConnectionIdentity(options.host, options.port, options.username, it, options.keyAlias)
  }

  /** Call on an IO dispatcher. This never prompts; a caller decides how to handle UNLOCK_REQUIRED. */
  suspend fun connect(lease: ConnectionLease, options: ConnectOptions): Map<String, Any?> {
    Crypto.ensureReady()
    if (lease.isReleased) return notConnected()
    val pair = when (val access = KeystoreKeys.withoutPrompt(options.keyAlias)) {
      is KeystoreKeys.KeyAccess.Ready -> access.pair
      KeystoreKeys.KeyAccess.NeedsUnlock -> return failure("UNLOCK_REQUIRED", UNLOCK_MESSAGE)
      KeystoreKeys.KeyAccess.Missing -> return failure("KEY_MISSING", "No key named ${options.keyAlias}.")
      KeystoreKeys.KeyAccess.Invalidated -> return failure(
        "KEY_INVALIDATED",
        "Android disabled the SSH key because the screen lock or fingerprints changed. Create a new key and authorize it on the host again.",
      )
    }
    var result = attempt(lease, options, options.host, pair)
    if (result["code"] == "HOST_NOT_FOUND") {
      delay(NAME_RETRY_DELAY_MS)
      result = attempt(lease, options, options.host, pair)
    }
    val fallback = options.fallbackHost
    if (result["code"] == "HOST_NOT_FOUND" && !fallback.isNullOrBlank() && fallback != options.host) {
      result = attempt(lease, options, fallback, pair)
    }
    return result
  }

  private fun attempt(lease: ConnectionLease, options: ConnectOptions, address: String, pair: KeyPair): Map<String, Any?> {
    if (lease.isReleased) return notConnected()
    var stage = Stage.CONNECTING
    var seen: String? = null
    val ssh = SSHClient(SshConfig.create())
    ssh.connectTimeout = CONNECT_TIMEOUT_MS
    ssh.timeout = SshConfig.CHANNEL_READ_TIMEOUT_MS
    ssh.addHostKeyVerifier(object : HostKeyVerifier {
      override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
        seen = Crypto.fingerprint(key)
        return seen == options.expectedFingerprint
      }
      override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = emptyList()
    })
    try {
      ssh.connect(address, options.port)
      stage = Stage.AUTHENTICATING
      ssh.connection.keepAlive.keepAliveInterval = SshConfig.KEEP_ALIVE_SECONDS
      ssh.authPublickey(options.username, KeyPairWrapper(pair))
      stage = Stage.CONNECTED
      val connectionId = UUID.randomUUID().toString()
      ssh.transport.setDisconnectListener { _, _ ->
        // Never wait for channel close on sshj's transport reader itself.
        Thread({ resources.drop(connectionId) }, "ssh-disconnected").apply { isDaemon = true; start() }
      }
      // Liveness is checked with publication; a rejected client is disconnected after the lock.
      if (!lease.publish(connectionId, ssh, identity(options)) { it.isConnected }) return notConnected()
      return mapOf("ok" to true, "connectionId" to connectionId, "fingerprint" to seen, "address" to address)
    } catch (e: Exception) {
      runCatching { ssh.disconnect() }
      val identity = seen
      if (e is TransportException && stage == Stage.CONNECTING && identity != null && identity != options.expectedFingerprint) {
        val code = if (options.expectedFingerprint == null) "HOST_KEY_UNKNOWN" else "HOST_KEY_CHANGED"
        return failure(code, "The host identity is $identity.", mapOf("fingerprint" to identity, "expected" to options.expectedFingerprint))
      }
      return classify(e, stage, address, options.port, options.username)
    }
  }

  /** Call on IO. Each forward belongs to exactly one lease, even on a shared client. */
  fun forwardLocal(lease: ConnectionLease, connectionId: String, remotePort: Int, remoteHost: String = LOOPBACK): Map<String, Any?> {
    if (remoteHost != LOOPBACK && remoteHost != "::1") return failure("SSH_ERROR", "Only loopback destinations are allowed.")
    if (remotePort !in 1..65535) return failure("SSH_ERROR", "Invalid port $remotePort.")
    val ssh = lease.connection(connectionId) ?: return notConnected()
    val socket = ServerSocket()
    try {
      socket.reuseAddress = true
      socket.bind(InetSocketAddress(LOOPBACK, 0))
    } catch (e: Exception) {
      runCatching { socket.close() }
      return failure("SSH_ERROR", "Cannot open a local port: ${e.message}")
    }
    val forwardId = UUID.randomUUID().toString()
    val forward = LoopbackForward(connectionId, ssh, socket, remotePort, remoteHost) { lease.closeForward(forwardId) }
    if (!lease.publishForward(forwardId, connectionId, ssh, forward)) return notConnected()
    forward.start()
    return mapOf("ok" to true, "forwardId" to forwardId, "localPort" to forward.localPort)
  }

  /** Called only for an actual failed transport, not an owner's normal disconnect. */
  fun transportClosed(connectionId: String) = resources.drop(connectionId)
}
