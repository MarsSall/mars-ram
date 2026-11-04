package expo.modules.ssh

import android.net.Uri
import android.util.Base64
import net.schmizz.sshj.connection.channel.direct.SessionChannel
import android.provider.OpenableColumns
import android.security.keystore.UserNotAuthenticatedException
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.sftp.FileAttributes
import net.schmizz.sshj.sftp.FileMode
import net.schmizz.sshj.sftp.OpenMode
import net.schmizz.sshj.sftp.SFTPClient
import net.schmizz.sshj.sftp.Response
import net.schmizz.sshj.sftp.SFTPException
import net.schmizz.sshj.transport.TransportException
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.sshj.userauth.keyprovider.KeyPairWrapper
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.KeyPair
import java.security.PublicKey
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class ConnectOptions : Record {
  @Field val host: String = ""
  /** Tried when the host name cannot be resolved, for example the host's Tailscale IP. */
  @Field val fallbackHost: String? = null
  @Field val port: Int = 22
  @Field val username: String = ""
  @Field val keyAlias: String = ""
  /** null on first contact: the module reports the host identity instead of trusting it. */
  @Field val expectedFingerprint: String? = null
}

/** Where a connection was when it failed; it decides what a timeout means. */
private enum class Stage { CONNECTING, AUTHENTICATING, CONNECTED }

private class SourceUnreadable(cause: Exception) : IOException("Cannot read the selected attachment. Select it again.", cause)

private const val CONNECT_TIMEOUT_MS = 10_000
private const val NAME_RETRY_DELAY_MS = 1_500L
internal const val LOOPBACK = "127.0.0.1"
private const val MAX_DIR_ENTRIES = 1_000
private const val UNLOCK_MESSAGE = "Unlock the phone to use the SSH key."

class SshModule : Module() {
  private val connections = ConcurrentHashMap<String, SSHClient>()
  private val forwards = ConcurrentHashMap<String, LoopbackForward>()
  private val terminals = ConcurrentHashMap<String, InteractiveTerminal>()
  /** Guards publishing connections, tunnels and terminals, so none outlives its connection. */
  private val lifecycle = Any()

  override fun definition() = ModuleDefinition {
    Name("Ssh")
    Events("onTerminalOutput", "onTerminalExit")

    OnCreate { Crypto.ensureReady() }

    OnDestroy {
      val closing = synchronized(lifecycle) {
        forwards.values.forEach { it.close() }
        forwards.clear()
        terminals.values.toList().forEach { it.close("module_destroyed") }
        terminals.clear()
        connections.values.toList().also { connections.clear() }
      }
      closing.forEach { runCatching { it.disconnect() } }
    }

    /** Returns the key's authorized_keys line, creating the key if it does not exist. */
    AsyncFunction("ensureKey") { alias: String, requireUnlock: Boolean, comment: String ->
      val pair = KeystoreKeys.load(alias) ?: KeystoreKeys.create(alias, requireUnlock)
      mapOf("publicKey" to Crypto.authorizedKeysLine(pair.public, comment), "fingerprint" to Crypto.fingerprint(pair.public))
    }

    AsyncFunction("deleteKey") { alias: String -> KeystoreKeys.delete(alias) }

    /** Asks for a fingerprint, face, PIN, or pattern; resolves true when the user unlocks. */
    AsyncFunction("unlock") { title: String, promise: Promise ->
      val activity = appContext.currentActivity as? FragmentActivity
        ?: throw Exceptions.MissingActivity()
      activity.runOnUiThread {
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = promise.resolve(true)
          override fun onAuthenticationError(code: Int, message: CharSequence) = promise.resolve(false)
        })
        prompt.authenticate(
          BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
            .build(),
        )
      }
    }

    /**
     * Opens a connection with the Keystore key. The host identity must match
     * expectedFingerprint; an unknown or changed identity is reported, never accepted.
     */
    AsyncFunction("connect") Coroutine { options: ConnectOptions -> withContext(Dispatchers.IO) { connect(options) } }

    /** Runs one command on an open connection, which stays open afterwards. */
    AsyncFunction("exec") Coroutine { connectionId: String, command: String ->
      withContext(Dispatchers.IO) { exec(connectionId, command) }
    }

    AsyncFunction("openTerminal") Coroutine { connectionId: String, command: List<String>, cols: Int, rows: Int, term: String? ->
      withContext(Dispatchers.IO) { openTerminal(connectionId, command, cols, rows, term ?: "xterm-256color") }
    }

    AsyncFunction("writeTerminal") Coroutine { terminalId: String, data: String ->
      withContext(Dispatchers.IO) {
        if (data.length > 87384) return@withContext failure("TOO_LARGE", "A terminal write is limited to 64 KiB.")
        // Linear validation, not a repeated regex that can exhaust the stack at the cap.
        val padding = if (data.endsWith("==")) 2 else if (data.endsWith("=")) 1 else 0
        if (data.length % 4 != 0 || !data.dropLast(padding).all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '+' || it == '/' }) {
          return@withContext failure("SSH_ERROR", "Invalid base64 terminal data.")
        }
        val bytes = try { Base64.decode(data, Base64.NO_WRAP) } catch (_: IllegalArgumentException) {
          return@withContext failure("SSH_ERROR", "Invalid base64 terminal data.")
        }
        if (bytes.size > 65536) return@withContext failure("TOO_LARGE", "A terminal write is limited to 64 KiB.")
        val terminal = terminals[terminalId] ?: return@withContext notConnected()
        try {
          terminal.write(bytes)
          mapOf("ok" to true)
        } catch (_: Exception) {
          terminal.close("channel_closed")
          failure("SSH_ERROR", "The terminal channel is closed.")
        }
      }
    }

    AsyncFunction("resizeTerminal") Coroutine { terminalId: String, cols: Int, rows: Int ->
      withContext(Dispatchers.IO) {
        if (!validTerminalSize(cols, rows)) return@withContext failure("SSH_ERROR", "PTY dimensions must be between 1 and 1000.")
        val terminal = terminals[terminalId] ?: return@withContext notConnected()
        try {
          terminal.resize(cols, rows)
          mapOf("ok" to true)
        } catch (_: Exception) {
          terminal.close("channel_closed")
          failure("SSH_ERROR", "The terminal channel is closed.")
        }
      }
    }

    AsyncFunction("closeTerminal") Coroutine { terminalId: String ->
      withContext(Dispatchers.IO) { synchronized(lifecycle) { terminals.remove(terminalId)?.close("closed") } }
      Unit
    }

    AsyncFunction("disconnect") Coroutine { connectionId: String ->
      withContext(Dispatchers.IO) { drop(connectionId)?.let { runCatching { it.disconnect() } } }
      Unit
    }

    /**
     * Whether an SSH server answers at host:port, reading only its greeting. No key is used, so it
     * never asks for an unlock.
     */
    AsyncFunction("probe") Coroutine { host: String, port: Int, timeoutMs: Int ->
      withContext(Dispatchers.IO) { probe(host, port, timeoutMs) }
    }

    /** Resolve the actual login home over SFTP, without invoking the host shell. */
    AsyncFunction("homeDirectory") Coroutine { connectionId: String ->
      withContext(Dispatchers.IO) {
        val ssh = connections[connectionId] ?: return@withContext notConnected()
        try {
          ssh.newSFTPClient().use { sftp ->
            val reported = sftp.canonicalize(".")
            val drive = reported.removePrefix("/")
            val path = if (Regex("^[A-Za-z]:[/\\\\].*").matches(drive)) drive.replace('/', '\\') else reported
            mapOf("ok" to true, "path" to path)
          }
        } catch (e: Exception) {
          sftpFailure(e, ".") ?: connectedFailure(connectionId, ssh, e)
        }
      }
    }

    /** Lists a host directory over SFTP; paths are relative to the user's home on Linux and Windows. */
    AsyncFunction("listDir") Coroutine { connectionId: String, path: String ->
      withContext(Dispatchers.IO) { listDir(connectionId, path) }
    }

    /** Reads a small UTF-8 text file over SFTP, refusing files larger than maxBytes. */
    AsyncFunction("readFile") Coroutine { connectionId: String, path: String, maxBytes: Int ->
      withContext(Dispatchers.IO) { readFile(connectionId, path, maxBytes) }
    }

    AsyncFunction("uploadFile") Coroutine { connectionId: String, sourceUri: String, remoteDir: String, remoteName: String, maxBytes: Double ->
      withContext(Dispatchers.IO) { uploadFile(connectionId, sourceUri, remoteDir, remoteName, maxBytes) }
    }

    AsyncFunction("removeFile") Coroutine { connectionId: String, path: String ->
      withContext(Dispatchers.IO) { removeFile(connectionId, path) }
    }

    /** Phone binds only IPv4 loopback; remote destination is exactly IPv4 or IPv6 loopback. */
    AsyncFunction("forwardLocal") Coroutine { connectionId: String, remotePort: Int, remoteHost: String? ->
      withContext(Dispatchers.IO) { forwardLocal(connectionId, remotePort, remoteHost ?: LOOPBACK) }
    }

    AsyncFunction("closeForward") Coroutine { forwardId: String ->
      // Remove and close under the lifecycle lock, so a concurrent disconnect never misses it.
      withContext(Dispatchers.IO) { synchronized(lifecycle) { forwards.remove(forwardId)?.close() } }
      Unit
    }

    /** Whether the connection is still open; keep-alives make a dead link show up as closed. */
    Function("isConnected") { connectionId: String ->
      connections[connectionId]?.let { it.isConnected && it.isAuthenticated } ?: false
    }
  }

  private suspend fun connect(options: ConnectOptions): Map<String, Any?> {
    val pair = KeystoreKeys.load(options.keyAlias) ?: return failure("KEY_MISSING", "No key named ${options.keyAlias}.")
    when (KeystoreKeys.usability(pair.private)) {
      KeystoreKeys.Usability.UNLOCK_REQUIRED -> return failure("UNLOCK_REQUIRED", UNLOCK_MESSAGE)
      KeystoreKeys.Usability.INVALIDATED -> return failure(
        "KEY_INVALIDATED",
        "Android disabled the SSH key because the screen lock or fingerprints changed. Create a new key and authorize it on the host again.",
      )
      KeystoreKeys.Usability.READY -> Unit
    }
    // A Tailscale name lookup can fail briefly: retry once, then try the fallback address.
    var result = attempt(options, options.host, pair)
    if (result["code"] == "HOST_NOT_FOUND") {
      delay(NAME_RETRY_DELAY_MS)
      result = attempt(options, options.host, pair)
    }
    val fallback = options.fallbackHost
    if (result["code"] == "HOST_NOT_FOUND" && !fallback.isNullOrBlank() && fallback != options.host) {
      result = attempt(options, fallback, pair)
    }
    return result
  }

  private fun attempt(options: ConnectOptions, address: String, pair: KeyPair): Map<String, Any?> {
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
        Thread({ drop(connectionId) }, "ssh-disconnected").apply { isDaemon = true; start() }
      }
      synchronized(lifecycle) {
        if (!ssh.isConnected) return notConnected()
        connections[connectionId] = ssh
      }
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

  private fun exec(connectionId: String, command: String): Map<String, Any?> {
    val ssh = connections[connectionId] ?: return notConnected()
    try {
      val session = ssh.startSession()
      try {
        val running = session.exec(command)
        // Commands are short and quiet; stderr is read after stdout.
        val stdout = running.inputStream.bufferedReader().readText()
        val stderr = running.errorStream.bufferedReader().readText()
        running.join(SshConfig.CHANNEL_READ_TIMEOUT_MS.toLong(), TimeUnit.MILLISECONDS)
        return mapOf("ok" to true, "stdout" to stdout, "stderr" to stderr, "exitStatus" to running.exitStatus)
      } finally {
        runCatching { session.close() }
      }
    } catch (e: Exception) {
      return connectedFailure(connectionId, ssh, e)
    }
  }

  private fun probe(host: String, port: Int, timeoutMs: Int): Boolean {
    if (port !in 1..65535 || timeoutMs <= 0) return false
    return try {
      Socket().use { socket ->
        socket.connect(InetSocketAddress(host, port), timeoutMs)
        socket.soTimeout = timeoutMs
        // SSH servers send "SSH-2.0-..." first; read at most one short line.
        val greeting = ByteArray(8)
        var read = 0
        while (read < 4) {
          val n = socket.getInputStream().read(greeting, read, greeting.size - read)
          if (n <= 0) break
          read += n
        }
        String(greeting, 0, read, Charsets.US_ASCII).startsWith("SSH-")
      }
    } catch (_: Exception) {
      false
    }
  }

  private fun listDir(connectionId: String, path: String): Map<String, Any?> {
    val ssh = connections[connectionId] ?: return notConnected()
    return try {
      ssh.newSFTPClient().use { sftp ->
        val listed = sftp.ls(path)
        if (listed.size > MAX_DIR_ENTRIES) return failure("TOO_LARGE", "$path has more than $MAX_DIR_ENTRIES entries.")
        val entries = listed.map { mapOf("name" to it.name, "isFile" to it.isRegularFile, "size" to it.attributes.size, "modifiedAt" to it.attributes.mtime * 1_000L) }
        mapOf("ok" to true, "entries" to entries)
      }
    } catch (e: Exception) {
      sftpFailure(e, path) ?: connectedFailure(connectionId, ssh, e)
    }
  }

  private fun readFile(connectionId: String, path: String, maxBytes: Int): Map<String, Any?> {
    if (maxBytes <= 0) return failure("SSH_ERROR", "The size limit must be positive.")
    val ssh = connections[connectionId] ?: return notConnected()
    return try {
      ssh.newSFTPClient().use { sftp ->
        sftp.open(path).use { file ->
          val length = file.length()
          if (length < 0 || length > maxBytes) return failure("TOO_LARGE", "$path is larger than $maxBytes bytes.")
          val bytes = ByteArray(length.toInt())
          var offset = 0
          while (offset < bytes.size) {
            val read = file.read(offset.toLong(), bytes, offset, bytes.size - offset)
            // A read that makes no progress ends the file, so the loop cannot spin.
            if (read <= 0) break
            offset += read
          }
          mapOf("ok" to true, "content" to String(bytes, 0, offset, Charsets.UTF_8))
        }
      }
    } catch (e: Exception) {
      sftpFailure(e, path) ?: connectedFailure(connectionId, ssh, e)
    }
  }

  /** Only our exclusive temporary file is removed on failure, never another upload's file. */
  private fun uploadFile(connectionId: String, sourceUri: String, remoteDir: String, remoteName: String, maxBytes: Double): Map<String, Any?> {
    if (!maxBytes.isFinite() || maxBytes <= 0) return failure("SSH_ERROR", "The size limit must be positive.")
    if (remoteName.isEmpty() || remoteName.startsWith(".") || remoteName.any { it == '/' || it == '\\' || it == ':' || it == '\u0000' } || remoteName.endsWith(".part")) {
      return failure("SSH_ERROR", "Invalid upload name")
    }
    val directories = remoteDir.split('/').filter { it.isNotEmpty() && it != "." }
    if (remoteDir.startsWith('/') || remoteDir.any { it == '\\' || it == ':' || it == '\u0000' } || directories.any { it == ".." }) {
      return failure("SSH_ERROR", "Upload directory must be relative to home.")
    }
    val ssh = connections[connectionId] ?: return notConnected()
    val directory = directories.joinToString("/").ifEmpty { "." }
    val path = "$directory/$remoteName"
    val part = "$path.part"
    return try {
      val uri = Uri.parse(sourceUri)
      if (uri.scheme != "content" && uri.scheme != "file") return failure("SOURCE_UNREADABLE", "Select an attachment from this device.")
      val resolver = appContext.reactContext?.contentResolver
        ?: return failure("SOURCE_UNREADABLE", "Cannot access the selected attachment. Select it again.")
      // Some document providers do not expose a size. The streaming limit remains authoritative.
      val declaredSize = runCatching {
        if (uri.scheme == "file") {
          uri.path?.let { File(it) }?.takeIf { it.isFile }?.length()
        } else {
          resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            val column = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (column >= 0 && cursor.moveToFirst() && !cursor.isNull(column)) cursor.getLong(column) else null
          }
        }
      }.getOrNull()
      if (declaredSize != null && declaredSize > maxBytes) return failure("TOO_LARGE", "The attachment is larger than ${maxBytes.toLong()} bytes.")
      val input = try {
        resolver.openInputStream(uri) ?: return failure("SOURCE_UNREADABLE", "Cannot open the selected attachment. Select it again.")
      } catch (e: Exception) { throw SourceUnreadable(e) }
      try {
        ssh.newSFTPClient().use { sftp ->
          ensureUploadDirectory(sftp, directories)
          if (exists(sftp, path)) return failure("SSH_ERROR", "An upload named $remoteName already exists.")
          var created = false
          try {
            var size = 0L
            sftp.open(part, setOf(OpenMode.CREAT, OpenMode.TRUNC, OpenMode.WRITE, OpenMode.EXCL),
              FileAttributes.Builder().withPermissions(384).build()).use { file -> // 0600
              created = true
              val buffer = ByteArray(32 * 1024)
              while (true) {
                val read = try { input.read(buffer) } catch (e: Exception) { throw SourceUnreadable(e) }
                if (read < 0) break
                if (read == 0) continue
                if (read > maxBytes - size) return failure("TOO_LARGE", "The attachment is larger than ${maxBytes.toLong()} bytes.")
                file.write(size, buffer, 0, read)
                size += read
              }
            }
            // Empty flags use standard SFTP rename, NOT OpenSSH's overwriting posix-rename.
            sftp.rename(part, path, emptySet())
            created = false
            mapOf("ok" to true, "size" to size)
          } finally {
            if (created) runCatching { sftp.rm(part) }
          }
        }
      } finally {
        runCatching { input.close() }
      }
    } catch (e: SourceUnreadable) {
      failure("SOURCE_UNREADABLE", e.message ?: "Cannot read the selected attachment. Select it again.")
    } catch (e: Exception) {
      sftpFailure(e, path) ?: connectedFailure(connectionId, ssh, e)
    }
  }

  private fun exists(sftp: SFTPClient, path: String): Boolean = try {
    sftp.lstat(path)
    true
  } catch (e: SFTPException) {
    if (e.statusCode == Response.StatusCode.NO_SUCH_FILE || e.statusCode == Response.StatusCode.NO_SUCH_PATH) false else throw e
  }

  private fun ensureUploadDirectory(sftp: SFTPClient, directories: List<String>) {
    var path = ""
    directories.forEach { name ->
      path = if (path.isEmpty()) name else "$path/$name"
      if (!exists(sftp, path)) {
        try {
          // Supply permissions with MKDIR: no interval where a new folder is public.
          sftp.getSFTPEngine().makeDir(path, FileAttributes.Builder().withPermissions(448).build()) // 0700
        } catch (e: SFTPException) {
          // Another upload may have created this parent. Never chmod an existing folder.
          if (!exists(sftp, path)) throw e
        }
      }
      if (sftp.lstat(path).type != FileMode.Type.DIRECTORY) throw IOException("Upload parent is not a directory: $path")
    }
  }

  private fun removeFile(connectionId: String, path: String): Map<String, Any?> {
    val ssh = connections[connectionId] ?: return notConnected()
    return try {
      ssh.newSFTPClient().use { sftp ->
        if (sftp.lstat(path).type != FileMode.Type.REGULAR) return failure("SSH_ERROR", "$path is not a regular file.")
        sftp.rm(path)
        mapOf("ok" to true)
      }
    } catch (e: Exception) {
      sftpFailure(e, path) ?: connectedFailure(connectionId, ssh, e)
    }
  }

  private fun forwardLocal(connectionId: String, remotePort: Int, remoteHost: String): Map<String, Any?> {
    if (remoteHost != LOOPBACK && remoteHost != "::1") return failure("SSH_ERROR", "Only loopback destinations are allowed.")
    if (remotePort !in 1..65535) return failure("SSH_ERROR", "Invalid port $remotePort.")
    val ssh = connections[connectionId] ?: return notConnected()
    val socket = ServerSocket()
    try {
      socket.reuseAddress = true
      // Only apps on this phone can reach the tunnel.
      socket.bind(InetSocketAddress(LOOPBACK, 0))
    } catch (e: Exception) {
      runCatching { socket.close() }
      return failure("SSH_ERROR", "Cannot open a local port: ${e.message}")
    }
    val forwardId = UUID.randomUUID().toString()
    val forward = LoopbackForward(connectionId, ssh, socket, remotePort, remoteHost) { forwards.remove(forwardId) }
    synchronized(lifecycle) {
      // The connection may have closed while the socket was opening.
      if (connections[connectionId] !== ssh) {
        forward.close()
        return notConnected()
      }
      forwards[forwardId] = forward
    }
    forward.start()
    return mapOf("ok" to true, "forwardId" to forwardId, "localPort" to forward.localPort)
  }

  private fun validTerminalSize(cols: Int, rows: Int) = cols in 1..1000 && rows in 1..1000

  private fun openTerminal(connectionId: String, command: List<String>, cols: Int, rows: Int, term: String): Map<String, Any?> {
    val path = command.firstOrNull() ?: ""
    val windows = Regex("""^[A-Za-z]:\\.*""").matches(path)
    val parts = path.split('/', '\\')
    val validPath = path == "herdr" ||
      ((path.startsWith('/') || windows) && Regex("""[A-Za-z0-9._/\\: -]+""").matches(path) &&
        parts.none { it == ".." } && parts.last() in listOf("herdr", "herdr.exe"))
    val allowed = validPath && (command.size == 1 ||
      (command.size == 3 && command[1] == "--session" && Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$").matches(command[2])))
    if (!allowed) return failure("SSH_ERROR", "Only Herdr can be opened")
    if (!validTerminalSize(cols, rows)) return failure("SSH_ERROR", "PTY dimensions must be between 1 and 1000.")
    if (!Regex("[A-Za-z0-9._-]{1,64}").matches(term)) return failure("SSH_ERROR", "Invalid terminal type.")
    val ssh = connections[connectionId] ?: return notConnected()
    var session: SessionChannel? = null
    try {
      session = ssh.startSession() as SessionChannel
      session.allocatePTY(term, cols, rows, 0, 0, emptyMap())
      // Exec is still parsed by the remote default shell. No quotes or expansion
      // characters survive validation. Windows uses cmd (PowerShell needs &).
      val executable = if (path == "herdr") path else if (windows) "\"$path\"" else "'$path'"
      session.exec(executable + if (command.size == 3) " --session ${command[2]}" else "")
      val terminalId = UUID.randomUUID().toString()
      val terminal = InteractiveTerminal(connectionId, session,
        { data -> sendEvent("onTerminalOutput", mapOf("terminalId" to terminalId, "data" to data)) },
        { status, reason ->
          terminals.remove(terminalId)
          sendEvent("onTerminalExit", mapOf("terminalId" to terminalId, "exitStatus" to status, "reason" to reason))
        },
      )
      synchronized(lifecycle) {
        if (connections[connectionId] !== ssh || !ssh.isConnected) {
          runCatching { session.close() }
          return notConnected()
        }
        terminals[terminalId] = terminal
      }
      terminal.start()
      return mapOf("ok" to true, "terminalId" to terminalId)
    } catch (_: Exception) {
      runCatching { session?.close() }
      if (!ssh.isConnected) drop(connectionId)
      return failure("SSH_ERROR", "Cannot open the Herdr terminal.")
    }
  }

  /** Removes a connection and closes its channels atomically; the caller disconnects it. */
  private fun drop(connectionId: String): SSHClient? = synchronized(lifecycle) {
    closeForwards(connectionId)
    val closing = terminals.filterValues { it.connectionId == connectionId }
    closing.keys.forEach { terminals.remove(it) }
    closing.values.forEach { it.close("connection_closed") }
    connections.remove(connectionId)
  }

  /** Called with the lifecycle lock held. */
  private fun closeForwards(connectionId: String) {
    val closing = forwards.filterValues { it.connectionId == connectionId }
    closing.keys.forEach { forwards.remove(it) }
    closing.values.forEach { it.close() }
  }

  private fun notConnected() = failure("NOT_CONNECTED", "The connection is closed. Connect again.")

  /** Failures on an open connection; a dead link is closed so the caller reconnects. */
  private fun connectedFailure(connectionId: String, ssh: SSHClient, e: Exception): Map<String, Any?> {
    if (!ssh.isConnected) {
      drop(connectionId)
      runCatching { ssh.disconnect() }
    }
    return classify(e, Stage.CONNECTED, ssh.remoteHostname ?: "", ssh.remotePort, "")
  }

  private fun sftpFailure(e: Exception, path: String): Map<String, Any?>? {
    val status = (e as? SFTPException)?.statusCode ?: return null
    return when (status) {
      Response.StatusCode.NO_SUCH_FILE, Response.StatusCode.NO_SUCH_PATH -> failure("NOT_FOUND", "$path does not exist on the host.")
      Response.StatusCode.PERMISSION_DENIED -> failure("PERMISSION_DENIED", "The host denied access to $path.")
      else -> null
    }
  }

  private fun classify(e: Exception, stage: Stage, address: String, port: Int, username: String): Map<String, Any?> {
    val cause = rootCause(e)
    val timedOut = cause is TimeoutException || cause is SocketTimeoutException
    return when {
      cause is UserNotAuthenticatedException -> failure("UNLOCK_REQUIRED", UNLOCK_MESSAGE)
      cause is UnknownHostException -> failure("HOST_NOT_FOUND", "Cannot resolve $address. Check that the phone is on the tailnet.")
      stage == Stage.CONNECTING && (timedOut || cause is ConnectException || cause is NoRouteToHostException) ->
        failure("UNREACHABLE", "Cannot reach $address:$port. Check that the phone is on the tailnet and the host is on.")
      // After the TCP connection opened, a timeout means the host stopped answering.
      timedOut -> failure("TIMEOUT", "The host stopped responding for ${SshConfig.CHANNEL_READ_TIMEOUT_MS / 1000} seconds.")
      e is UserAuthException ->
        failure("AUTH_FAILED", "The host did not accept the app's key for $username.", mapOf("detail" to describe(e)))
      else -> failure("SSH_ERROR", cause.message ?: cause.javaClass.simpleName)
    }
  }

  private fun failure(code: String, message: String, extra: Map<String, Any?> = emptyMap()) =
    mapOf("ok" to false, "code" to code, "message" to message) + extra

  /** Exception chain, including suppressed causes, for diagnosing failures sshj wraps. */
  private fun describe(e: Throwable): String {
    val parts = mutableListOf<String>()
    var current: Throwable? = e
    while (current != null && parts.size < 8) {
      parts += "${current.javaClass.simpleName}: ${current.message}"
      current.suppressed.take(2).forEach { parts += "suppressed ${it.javaClass.simpleName}: ${it.message}" }
      current = current.cause.takeIf { it !== current }
    }
    return parts.take(8).joinToString(" <- ").take(1_000)
  }

  /** Deepest cause, stopping if the cause chain loops. */
  private fun rootCause(e: Throwable): Throwable {
    val seen = mutableSetOf<Throwable>()
    var current = e
    while (seen.add(current)) current = current.cause ?: break
    return current
  }
}
