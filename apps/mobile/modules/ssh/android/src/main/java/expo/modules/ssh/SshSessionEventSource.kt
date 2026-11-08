package expo.modules.ssh

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import net.schmizz.sshj.sftp.OpenMode
import net.schmizz.sshj.sftp.Response
import net.schmizz.sshj.sftp.SFTPException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/** All credentials and response bodies stay in memory; exceptions are never logged or sent to JS. */
internal class SshSessionEventSource(private val appId: String) : SessionEventSource {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val output = Channel<WatchEvent>(64)
  private val requests = ConcurrentHashMap.newKeySet<HttpURLConnection>()
  private val leases = ConcurrentHashMap.newKeySet<ConnectionLease>()
  private val resumes = ConcurrentHashMap<String, UnlockResume>()
  private var configured = false
  override fun configure(hosts: List<WatchHost>) {
    check(!configured)
    configured = true
    hosts.forEach { host -> resumes[host.id] = UnlockResume() }
    hosts.forEach { host -> scope.launch { watchHost(host, resumes.getValue(host.id)) } }
  }
  /** Only a host parked for an unlock continues; other hosts keep their own backoff. */
  override fun unlocked(hostId: String) { resumes[hostId]?.resume() }
  override fun events() = output.receiveAsFlow()
  override fun close() {
    scope.cancel()
    requests.forEach { it.disconnect() }
    leases.forEach { it.close() }
    output.close()
  }

  private class Cursor(var seq: Long = 0, var initialized: Boolean = false)
  private class Gap : IOException()

  private suspend fun watchHost(host: WatchHost, resume: UnlockResume) {
    val cursors = mutableMapOf<String, Cursor>()
    superviseWatchHost(resume, { connected ->
      val lease = ConnectionManager.acquire(LeaseOwner.SERVICE)
      leases.add(lease)
      try {
        val options = ConnectOptions(host.host, host.fallbackHost, host.port, host.username, host.keyAlias, host.expectedFingerprint)
        val connectionId = acquireWatchConnection(
          adopt = { ConnectionManager.adopt(lease, options) },
          signWithoutPrompt = {
            // The real alias may be the previous generation while rotation is pending.
            when (KeystoreKeys.signWithoutPrompt(host.keyAlias, byteArrayOf(0))) {
              KeystoreKeys.SignResult.NeedsUnlock -> throw WatchUnlockRequired()
              KeystoreKeys.SignResult.Missing, KeystoreKeys.SignResult.Invalidated -> throw IOException()
              is KeystoreKeys.SignResult.Signed -> Unit
            }
          },
          connect = {
            val result = ConnectionManager.connect(lease, options)
            if (result["code"] == "UNLOCK_REQUIRED") throw WatchUnlockRequired()
            if (result["ok"] != true) throw IOException()
            result["connectionId"] as String
          },
        )
        coroutineScope {
          val bridges = mutableMapOf<String, Job>()
          try {
            while (isActive) {
              val found = discover(lease, connectionId)
              connected()
              output.send(WatchEvent.HostState(host.id, "connected"))
              val ids = found.map { it.id }.toSet()
              for (id in bridges.keys.toList().filter { it !in ids }) {
                bridges.remove(id)?.cancelAndJoin()
                cursors.remove(id)
                output.send(WatchEvent.Removed(SessionKey(host.id, id)))
              }
              found.forEach { entry ->
                if (bridges[entry.id]?.isActive != true) {
                  val cursor = cursors.getOrPut(entry.id) { Cursor() }
                  bridges[entry.id] = launch { watchBridge(host.id, entry, lease, connectionId, cursor) }
                }
              }
              delay(30_000)
            }
          } finally { bridges.values.forEach { it.cancel() } }
        }
      } finally {
        lease.close()
        leases.remove(lease)
      }
    }, { state -> output.send(WatchEvent.HostState(host.id, state)) })
  }

  private fun discover(lease: ConnectionLease, id: String): List<WatchRegistration> {
    val ssh = lease.connection(id) ?: throw IOException()
    ssh.newSFTPClient().use { sftp ->
      val directory = ".$appId/bridges"
      val files = try { sftp.ls(directory) } catch (e: SFTPException) {
        if (e.statusCode == Response.StatusCode.NO_SUCH_FILE) return emptyList() else throw e
      }
      if (files.size > 1000) throw IOException()
      return files.filter { it.isRegularFile && it.name.endsWith(".json") && safeRegistryName(it.name) }.mapNotNull { file ->
        try {
          if (file.attributes.size > 65536) return@mapNotNull null
          val text = sftp.open("$directory/${file.name}", setOf(OpenMode.READ)).use { remote ->
            remote.RemoteFileInputStream().use { stream ->
              val bytes = readBounded(stream, 65537)
              if (bytes.size > 65536) return@mapNotNull null
              bytes.toString(Charsets.UTF_8)
            }
          }
          val json = JSONObject(text)
          decodeWatchRegistration(json.keys().asSequence().associateWith { key -> json.opt(key).takeUnless { it === JSONObject.NULL } })
        } catch (e: SFTPException) {
          if (e.statusCode == Response.StatusCode.NO_SUCH_FILE) null else throw e
        } catch (_: org.json.JSONException) { null }
      }
    }
  }

  private suspend fun watchBridge(hostId: String, entry: WatchRegistration, lease: ConnectionLease, id: String, cursor: Cursor) {
    val key = SessionKey(hostId, entry.id)
    while (currentCoroutineContext().isActive && lease.connection(id) != null) {
      val forward = ConnectionManager.forwardLocal(lease, id, entry.port)
      if (forward["ok"] != true) return
      val forwardId = forward["forwardId"] as String
      val base = "http://127.0.0.1:${forward["localPort"]}"
      try {
        if (!cursor.initialized) snapshot(base, entry, key, cursor)
        stream(base, entry, key, cursor)
      } catch (e: CancellationException) { throw e
      } catch (_: Gap) {
        cursor.initialized = false // Next /state is silent, including any lastOutcome.
      } catch (_: Exception) { /* A stale bridge is not evidence that the host is lost. */
      } finally { lease.closeForward(forwardId) }
      delay(2_000)
    }
  }

  private fun request(base: String, path: String, token: String): HttpURLConnection {
    // Header transport safety, deliberately separate from the canonical registry schema.
    if (token.any { it == '\r' || it == '\n' }) throw IOException()
    val connection = URL(base + path).openConnection() as HttpURLConnection
    requests.add(connection)
    connection.instanceFollowRedirects = false // Never forward a Bearer token to a redirect target.
    connection.connectTimeout = 10_000
    connection.readTimeout = 30_000
    connection.setRequestProperty("Authorization", "Bearer $token")
    return connection
  }

  private suspend fun snapshot(base: String, entry: WatchRegistration, key: SessionKey, cursor: Cursor) {
    val request = request(base, "/state", entry.token)
    try {
      if (request.responseCode != 200) throw IOException()
      val bytes = request.inputStream.use { readBounded(it, 65537) }
      if (bytes.size > 65536) throw IOException()
      val json = JSONObject(bytes.toString(Charsets.UTF_8))
      envelope(json, entry)
      val seq = integer(json, "lastSeq") ?: throw IOException()
      if (seq < 0 || json.opt("idle") !is Boolean || !json.has("pendingPrompt")) throw IOException()
      output.send(WatchEvent.Snapshot(key, entry.project, seq, !json.getBoolean("idle"), !json.isNull("pendingPrompt"), entry.protocolVersion))
      cursor.seq = seq
      cursor.initialized = true
    } finally { requests.remove(request); request.disconnect() }
  }

  private suspend fun stream(base: String, entry: WatchRegistration, key: SessionKey, cursor: Cursor) {
    val request = request(base, "/events?since=${cursor.seq}", entry.token)
    try {
      if (request.responseCode != 200) throw IOException()
      var replaySeen = false
      request.inputStream.bufferedReader().use { reader ->
        // Bounded line and frame buffers, even for hostile/huge agent text. No text escapes this adapter.
        var line = StringBuilder()
        var data = StringBuilder()
        var event = ""
        var oversized = false
        while (currentCoroutineContext().isActive) {
          val char = reader.read()
          if (char == -1) throw IOException()
          if (char != 10) {
            if (line.length < 1_048_576) line.append(char.toChar()) else oversized = true
            continue
          }
          val text = line.toString().removeSuffix("\r")
          line = StringBuilder()
          if (text.isEmpty()) {
            if (!oversized && data.isNotEmpty()) {
              val json = JSONObject(data.toString())
              if (event == "replay") {
                envelope(json, entry)
                if (json.opt("gap") !is Boolean) throw IOException()
                if (json.getBoolean("gap")) throw Gap()
                replaySeen = true
              } else {
                if (!replaySeen) throw IOException()
                val seq = integer(json, "seq") ?: throw IOException()
                val type = json.opt("type") as? String ?: throw IOException()
                if (seq > cursor.seq) {
                  // Validate only the projection needed for policy, ignoring additive/unknown events.
                  if (type == "agent_settled" && (json.opt("aborted") !is Boolean || json.opt("pendingMessages") !is Boolean)) throw IOException()
                  val outcome = if (json.has("outcome")) json.opt("outcome") as? String ?: throw IOException() else null
                  output.send(WatchEvent.Event(key, seq, type, outcome, json.optBoolean("aborted"), entry.protocolVersion))
                  cursor.seq = seq
                }
              }
            }
            data = StringBuilder(); event = ""; oversized = false
          } else if (text.startsWith("event:")) event = text.substring(6).trim()
          else if (text.startsWith("data:")) {
            if (data.length + text.length <= 1_048_576) {
              if (data.isNotEmpty()) data.append('\n')
              data.append(text.substring(5).removePrefix(" "))
            } else oversized = true
          }
        }
      }
    } finally { requests.remove(request); request.disconnect() }
  }

  private fun readBounded(stream: java.io.InputStream, limit: Int): ByteArray {
    val result = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(4096)
    while (result.size() < limit) {
      val count = stream.read(buffer, 0, minOf(buffer.size, limit - result.size()))
      if (count < 0) break
      result.write(buffer, 0, count)
    }
    return result.toByteArray()
  }

  private fun envelope(json: JSONObject, entry: WatchRegistration) {
    val version = json.opt("protocolVersion") as? String ?: throw IOException()
    if (!compatibleWatchProtocol(version) || json.opt("bridgeInstanceId") != entry.id || json.opt("sessionId") != entry.sessionId) throw IOException()
  }
  private fun integer(json: JSONObject, key: String): Long? = (json.opt(key) as? Number)?.let {
    val number = it.toDouble()
    if (number.isFinite() && number >= 0 && number <= 9_007_199_254_740_991.0 && number == it.toLong().toDouble()) it.toLong() else null
  }
  private fun safeRegistryName(name: String) = name.length <= 255 && name != "." && name != ".." && name.none { it == '/' || it == '\\' || it.isISOControl() }
}

/** Local saved-host configuration constraint; never applied to bridge/session wire IDs. */
internal fun validWatchHostId(id: String) = id.length in 1..200 && id.all { it.isLetterOrDigit() || it in "._:-" }
