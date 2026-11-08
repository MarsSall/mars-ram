package expo.modules.ssh

internal enum class LeaseOwner { UI, SERVICE }

/** Cleanup collected under the lock and run, in order, only after it is released. */
private typealias Closers = MutableList<() -> Unit>
private fun Closers.run() = forEach { runCatching { it() } }

/**
 * Process-local ownership only: no Android, SSH, credentials, or persisted state.
 * The lock guards bookkeeping only. Closing a client, forward, or detached owner's channels can
 * wait for the host, so it always runs after the lock is released: a slow close never stalls
 * another connect, adoption, or isConnected.
 */
internal class ResourceLeases<C : Any, F : Any>(
  private val closeConnection: (C) -> Unit,
  private val closeForwardResource: (F) -> Unit,
) {
  /** Also guards module-scoped channel publication against connection/lease release. Never close under it. */
  val lock = Any()
  private inner class Connection(val client: C, val holders: MutableSet<Lease>, val identity: ConnectionIdentity?)
  private inner class Forward(val owner: Lease, val connectionId: String, val resource: F)
  private val connections = mutableMapOf<String, Connection>()
  private val forwards = mutableMapOf<String, Forward>()

  fun acquire(owner: LeaseOwner, onDetached: (String) -> Unit = {}): Lease = Lease(owner, onDetached)

  /** A transport failure invalidates every holder; ordinary disconnect releases only one. */
  fun drop(connectionId: String) {
    val closers: Closers = mutableListOf()
    synchronized(lock) {
      val connection = connections.remove(connectionId) ?: return
      connection.holders.forEach { lease ->
        removeForwards(lease, connectionId, closers)
        closers.add { lease.notifyDetached(connectionId) }
      }
      closers.add { closeConnection(connection.client) }
    }
    closers.run()
  }

  /** With lock held. */
  private fun removeForwards(owner: Lease, connectionId: String, closers: Closers) {
    val closing = forwards.filterValues { it.owner === owner && it.connectionId == connectionId }
    closing.keys.forEach { forwards.remove(it) }
    closing.values.forEach { closers.add { closeForwardResource(it.resource) } }
  }

  inner class Lease internal constructor(val owner: LeaseOwner, private val onDetached: (String) -> Unit) {
    private var released = false
    val isReleased: Boolean get() = synchronized(lock) { released }

    /**
     * Takes ownership of a new client, including disposing of a late rejected publication.
     * [isLive] is checked atomically with publication, so a transport that died meanwhile is
     * either rejected here or removed by its drop, never left published.
     */
    fun publish(connectionId: String, client: C, identity: ConnectionIdentity? = null, isLive: (C) -> Boolean = { true }): Boolean {
      val accepted = synchronized(lock) {
        if (released || connections.containsKey(connectionId) || !isLive(client)) false
        else {
          connections[connectionId] = Connection(client, mutableSetOf(this), identity)
          true
        }
      }
      if (!accepted) runCatching { closeConnection(client) }
      return accepted
    }

    /** Lookup, liveness check, and retain are atomic with UI release and transport removal. */
    fun retainMatching(identity: ConnectionIdentity, isLive: (C) -> Boolean): String? = synchronized(lock) {
      if (released) return@synchronized null
      val id = connections.entries.firstOrNull { (_, connection) ->
        connection.identity == identity && isLive(connection.client)
      }?.key ?: return@synchronized null
      if (retain(id)) id else null
    }

    /** Explicit handoff/sharing by connection capability. */
    fun retain(connectionId: String): Boolean = synchronized(lock) {
      if (released) return@synchronized false
      val connection = connections[connectionId] ?: return@synchronized false
      connection.holders.add(this)
      true
    }

    fun connection(connectionId: String): C? = synchronized(lock) {
      connections[connectionId]?.takeIf { !released && this in it.holders }?.client
    }

    fun disconnect(connectionId: String) {
      val closers: Closers = mutableListOf()
      synchronized(lock) { detach(connectionId, closers) }
      closers.run()
    }

    /** With lock held. Removes just this lease's hold and forwards; the last holder disposes. */
    private fun detach(connectionId: String, closers: Closers) {
      val connection = connections[connectionId] ?: return
      if (!connection.holders.remove(this)) return
      removeForwards(this, connectionId, closers)
      closers.add { notifyDetached(connectionId) }
      if (connection.holders.isEmpty()) {
        connections.remove(connectionId)
        closers.add { closeConnection(connection.client) }
      }
    }

    internal fun notifyDetached(connectionId: String) { runCatching { onDetached(connectionId) } }

    fun publishForward(id: String, connectionId: String, expected: C, forward: F): Boolean {
      val accepted = synchronized(lock) {
        if (connection(connectionId) !== expected || forwards.containsKey(id)) false
        else {
          forwards[id] = Forward(this, connectionId, forward)
          true
        }
      }
      if (!accepted) runCatching { closeForwardResource(forward) }
      return accepted
    }

    fun closeForward(id: String) {
      val forward = synchronized(lock) {
        forwards[id]?.takeIf { it.owner === this }?.also { forwards.remove(id) }
      } ?: return
      runCatching { closeForwardResource(forward.resource) }
    }

    /** Idempotent; sets the tombstone before removing anything to reject in-flight opens. */
    fun close() {
      val closers: Closers = mutableListOf()
      synchronized(lock) {
        if (released) return
        released = true
        connections.keys.toList().forEach { detach(it, closers) }
      }
      closers.run()
    }
  }
}
