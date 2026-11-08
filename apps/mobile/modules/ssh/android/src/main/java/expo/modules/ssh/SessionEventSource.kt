package expo.modules.ssh

import kotlinx.coroutines.flow.Flow

/** Technology-free event source: a relay adapter can replace SSH without changing alert policy. */
internal interface SessionEventSource {
  fun configure(hosts: List<WatchHost>)
  fun events(): Flow<WatchEvent>
  /** The visible UI connected to this host: a host stopped for an unlock resumes watching. */
  fun unlocked(hostId: String)
  fun close()
}

internal data class WatchHost(
  val id: String, val host: String, val fallbackHost: String?, val port: Int,
  val username: String, val keyAlias: String, val expectedFingerprint: String,
)
internal sealed interface WatchEvent {
  data class Snapshot(val key: SessionKey, val project: String, val seq: Long, val active: Boolean, val waiting: Boolean, val protocolVersion: String) : WatchEvent
  data class Event(val key: SessionKey, val seq: Long, val type: String, val outcome: String?, val aborted: Boolean, val protocolVersion: String) : WatchEvent
  data class Removed(val key: SessionKey) : WatchEvent
  data class HostState(val hostId: String, val state: String) : WatchEvent
}

/**
 * The running source with the hosts it was configured with. A UI connect resumes by these
 * hosts, never by a newer armed configuration whose source has not attached yet.
 */
internal class WatchAttachment {
  private var source: SessionEventSource? = null
  private var hosts: List<WatchHost> = emptyList()
  @Synchronized fun attach(source: SessionEventSource, hosts: List<WatchHost>) { this.source = source; this.hosts = hosts }
  @Synchronized fun detach(source: SessionEventSource) { if (this.source === source) { this.source = null; hosts = emptyList() } }
  /** The attached source and its host IDs matching the connection, or null when none match. */
  @Synchronized fun resume(host: String, port: Int, username: String, keyAlias: String, expectedFingerprint: String?): Pair<SessionEventSource, List<String>>? {
    val current = source ?: return null
    val ids = hosts.filter {
      it.host == host && it.port == port && it.username == username && it.expectedFingerprint == expectedFingerprint && it.keyAlias == keyAlias
    }.map { it.id }
    return if (ids.isEmpty()) null else current to ids
  }
}
