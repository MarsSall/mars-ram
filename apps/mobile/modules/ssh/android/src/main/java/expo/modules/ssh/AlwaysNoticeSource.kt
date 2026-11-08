package expo.modules.ssh

import kotlinx.coroutines.flow.Flow

internal data class AlwaysWatchHost(val hostId: String, val hostKeyId: String)
internal interface AlwaysNoticeSource {
  fun events(): Flow<SessionAlert>
  fun close()
}
internal fun validAlwaysWatchHosts(hosts: List<AlwaysWatchHost>): Boolean = hosts.size in 1..32 &&
  hosts.all { validWatchHostId(it.hostId) && it.hostKeyId.length in 1..256 && it.hostKeyId.none { c -> c.isISOControl() } } &&
  hosts.map { it.hostId }.toSet().size == hosts.size && hosts.map { it.hostKeyId }.toSet().size == hosts.size
