package expo.modules.ssh

import android.net.Uri
import android.util.Base64
import net.schmizz.sshj.connection.channel.direct.SessionChannel
import android.provider.OpenableColumns
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
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.sftp.FileAttributes
import net.schmizz.sshj.sftp.FileMode
import net.schmizz.sshj.sftp.OpenMode
import net.schmizz.sshj.sftp.SFTPClient
import net.schmizz.sshj.sftp.Response
import net.schmizz.sshj.sftp.SFTPException
import java.io.File
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class ConnectOptions(
  @Field val host: String = "",
  /** Tried when the host name cannot be resolved, for example the host's Tailscale IP. */
  @Field val fallbackHost: String? = null,
  @Field val port: Int = 22,
  @Field val username: String = "",
  @Field val keyAlias: String = "",
  /** null on first contact: the module reports the host identity instead of trusting it. */
  @Field val expectedFingerprint: String? = null,
) : Record

private class SourceUnreadable(cause: Exception) : IOException("Cannot read the selected attachment. Select it again.", cause)

internal const val LOOPBACK = "127.0.0.1"
private const val MAX_DIR_ENTRIES = 1_000

class SshModule : Module() {
  private val terminals = ConcurrentHashMap<String, InteractiveTerminal>()
  private val lifecycle get() = ConnectionManager.lifecycle
  private var playUpdates: PlayAppUpdates? = null
  @Synchronized private fun playUpdates(): PlayAppUpdates? = playUpdates
    ?: appContext.reactContext?.applicationContext?.let { context ->
      PlayAppUpdates(context) { status -> sendEvent("onAppUpdateStatus", mapOf("status" to status)) }.also { playUpdates = it }
    }
  // Runs after the lifecycle lock is released: closing a channel can wait for the host.
  private val lease = ConnectionManager.acquire(LeaseOwner.UI) { connectionId ->
    val closing = terminals.filterValues { it.connectionId == connectionId }
    closing.keys.forEach { terminals.remove(it) }
    closing.values.forEach { it.close("connection_closed") }
  }

  override fun definition() = ModuleDefinition {
    Name("Ssh")
    Events("onTerminalOutput", "onTerminalExit", "onAppUpdateStatus")

    OnCreate { Crypto.ensureReady() }

    OnDestroy {
      val closing = synchronized(lifecycle) { terminals.values.toList().also { terminals.clear() } }
      closing.forEach { it.close("module_destroyed") }
      // A tombstoned UI lease rejects late connection/forward/channel publication.
      // Other owners keep their clients and their own forwards.
      lease.close()
      playUpdates?.stopListening()
    }

    Function("appBuild") { installedBuild(appContext.reactContext) }
    AsyncFunction("checkAppUpdate") Coroutine { -> playUpdates()?.check() ?: appUpdateResult(null, null) }
    AsyncFunction("startFlexibleUpdate") Coroutine { -> playUpdates()?.start(appContext.currentActivity) ?: startResult(null) }
    AsyncFunction("appUpdateProgress") Coroutine { -> playUpdates()?.progress() ?: installProgress(null) }
    AsyncFunction("completeUpdate") Coroutine { -> playUpdates()?.complete(); Unit }

    AsyncFunction("startSessionWatch") { config: SessionWatchConfig ->
      SessionWatchControl.start(appContext.currentActivity as? FragmentActivity, config)
    }
    AsyncFunction("stopSessionWatch") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SessionWatchControl.stop(context)
    }
    Function("sessionWatchStatus") { SessionWatchControl.status }
    AsyncFunction("registerAlwaysNotify") Coroutine { hostId: String ->
      withContext(Dispatchers.IO) {
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        try { mapOf("secret" to AlwaysNotifySecrets.get(context).register(hostId), "port" to ALWAYS_NOTIFY_PORT) }
        catch (_: Exception) { throw IllegalStateException("NOTIFY_STORAGE_FAILED") }
      }
    }
    AsyncFunction("forgetAlwaysNotify") Coroutine { hostId: String ->
      withContext(Dispatchers.IO) {
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        try { AlwaysNotifySecrets.get(context).forget(hostId) }
        catch (_: Exception) { throw IllegalStateException("NOTIFY_STORAGE_FAILED") }
      }
    }
    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      (context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager).isIgnoringBatteryOptimizations(context.packageName)
    }
    AsyncFunction("openBatteryOptimizationSettings") Coroutine { ->
      withContext(Dispatchers.Main) {
        val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
        val opened = launchBatterySettings(activity.packageName) { target ->
          val intent = android.content.Intent(target.action)
          target.uri?.let { intent.data = android.net.Uri.parse(it) }
          // Launch directly: resolver queries can hide Settings under Android package visibility.
          // ActivityNotFoundException (or a rejected launch) triggers the policy's fallback.
          activity.startActivity(intent)
          true
        }
        if (!opened) throw IllegalStateException("SETTINGS_UNAVAILABLE")
      }
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
    AsyncFunction("connect") Coroutine { options: ConnectOptions -> withContext(Dispatchers.IO) {
      ConnectionManager.connect(lease, options).also { result ->
        if (result["ok"] == true) appContext.reactContext?.let { SessionWatchControl.connected(it, options) }
      }
    } }

    /** Runs one command on an open connection, which stays open afterwards. */
    AsyncFunction("exec") Coroutine { connectionId: String, command: String ->
      withContext(Dispatchers.IO) { exec(connectionId, command) }
    }

    /** Bounded stdin for notification registration; never interpolate secrets into commands. */
    AsyncFunction("execWithInput") Coroutine { connectionId: String, command: String, input: String ->
      withContext(Dispatchers.IO) { execWithInput(connectionId, command, input) }
    }
    AsyncFunction("setNotificationLanguage") { language: String ->
      SessionWatchControl.language = if (language == "es") "es" else "en"
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
      withContext(Dispatchers.IO) { synchronized(lifecycle) { terminals.remove(terminalId) }?.close("closed") }
      Unit
    }

    AsyncFunction("disconnect") Coroutine { connectionId: String ->
      withContext(Dispatchers.IO) { lease.disconnect(connectionId) }
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
        val ssh = lease.connection(connectionId) ?: return@withContext notConnected()
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
      withContext(Dispatchers.IO) { ConnectionManager.forwardLocal(lease, connectionId, remotePort, remoteHost ?: LOOPBACK) }
    }

    AsyncFunction("closeForward") Coroutine { forwardId: String ->
      // Removed under the lifecycle lock, so a concurrent disconnect never misses it; closed after.
      withContext(Dispatchers.IO) { lease.closeForward(forwardId) }
      Unit
    }

    /** Whether the connection is still open; keep-alives make a dead link show up as closed. */
    Function("isConnected") { connectionId: String ->
      lease.connection(connectionId)?.let { it.isConnected && it.isAuthenticated } ?: false
    }
  }

  private suspend fun execWithInput(connectionId: String, command: String, input: String): Map<String, Any?> = coroutineScope {
    if (input.toByteArray(Charsets.UTF_8).size > 1024 || command.length > 4096) return@coroutineScope failure("TOO_LARGE", "Command input is too large.")
    val ssh = lease.connection(connectionId) ?: return@coroutineScope notConnected()
    try {
      ssh.startSession().use { session ->
        // Absolute deadline also closes a channel that continuously produces output.
        val deadline = launch(Dispatchers.IO) { delay(30_000); runCatching { session.close() } }
        try {
          val running = session.exec(command)
          fun readBounded(stream: java.io.InputStream): String {
            val bytes = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(1024)
            while (true) {
              val n = stream.read(buffer)
              if (n < 0) break
              if (bytes.size() + n > 4096) throw IOException("Command output too large")
              bytes.write(buffer, 0, n)
            }
            return bytes.toString("UTF-8")
          }
          val stderr = async(Dispatchers.IO) { readBounded(running.errorStream) }
          running.outputStream.write(input.toByteArray(Charsets.UTF_8))
          running.outputStream.flush()
          running.outputStream.close() // SSH EOF lets the CLI finish reading JSON stdin.
          val stdout = readBounded(running.inputStream)
          val error = stderr.await()
          running.join(30, TimeUnit.SECONDS)
          mapOf("ok" to true, "stdout" to stdout, "stderr" to error, "exitStatus" to running.exitStatus)
        } finally { deadline.cancel() }
      }
    } catch (_: Exception) {
      // Do not surface remote diagnostics: a compromised command may echo stdin.
      failure("SSH_ERROR", "Notification registration command failed.")
    }
  }

  private fun exec(connectionId: String, command: String): Map<String, Any?> {
    val ssh = lease.connection(connectionId) ?: return notConnected()
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
    val ssh = lease.connection(connectionId) ?: return notConnected()
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
    val ssh = lease.connection(connectionId) ?: return notConnected()
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
    val ssh = lease.connection(connectionId) ?: return notConnected()
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
    val ssh = lease.connection(connectionId) ?: return notConnected()
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
    val ssh = lease.connection(connectionId) ?: return notConnected()
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
      val registered = synchronized(lifecycle) {
        (lease.connection(connectionId) === ssh && ssh.isConnected).also { if (it) terminals[terminalId] = terminal }
      }
      if (!registered) {
        runCatching { session.close() }
        return notConnected()
      }
      terminal.start()
      return mapOf("ok" to true, "terminalId" to terminalId)
    } catch (_: Exception) {
      runCatching { session?.close() }
      if (!ssh.isConnected) ConnectionManager.transportClosed(connectionId)
      return failure("SSH_ERROR", "Cannot open the Herdr terminal.")
    }
  }

  /** Failures on an open connection; a dead link is closed so the caller reconnects. */
  private fun connectedFailure(connectionId: String, ssh: SSHClient, e: Exception): Map<String, Any?> {
    if (!ssh.isConnected) {
      ConnectionManager.transportClosed(connectionId)
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

}
