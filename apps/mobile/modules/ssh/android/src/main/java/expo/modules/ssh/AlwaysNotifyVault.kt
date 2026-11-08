package expo.modules.ssh

import org.json.JSONObject

/** Implementations encrypt at rest and exclude records from backup. Calls are serialized by the vault. */
internal interface AlwaysSecretPersistence {
  fun read(hostId: String): String?
  fun write(hostId: String, plaintext: String)
  fun forget(hostId: String)
}
internal class AlwaysNotifyVault(private val storage: AlwaysSecretPersistence, private val random: () -> ByteArray) {
  private fun read(id: String): JSONObject? {
    require(validWatchHostId(id))
    return storage.read(id)?.let { text ->
      require(text.toByteArray().size <= 131072)
      JSONObject(text).also { require(Regex("[a-f0-9]{64}").matches(it.getString("secret"))) }
    }
  }
  @Synchronized fun register(hostId: String): String {
    val existing = read(hostId)
    if (existing != null) return existing.getString("secret")
    val bytes = random(); require(bytes.size == 32)
    val hex = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
    storage.write(hostId, JSONObject().put("secret", hex).put("replay", JSONObject()).toString())
    return hex
  }
  @Synchronized fun secret(hostId: String): ByteArray? = read(hostId)?.getString("secret")?.chunked(2)?.map { it.toInt(16).toByte() }?.toByteArray()
  @Synchronized fun forget(hostId: String) { require(validWatchHostId(hostId)); storage.forget(hostId) }
  /** Called only after HMAC verification. Commit before notifying; storage failure fails closed. */
  @Synchronized fun acceptReplay(hostId: String, instance: String, seq: Long, sentAt: Long, now: Long, expectedSecret: ByteArray? = null): Boolean {
    val record = read(hostId) ?: return false
    if (expectedSecret != null && !java.security.MessageDigest.isEqual(secret(hostId), expectedSecret)) return false
    if (sentAt < now - ALWAYS_WINDOW_MS || sentAt > now + ALWAYS_WINDOW_MS) return false
    val replay = record.getJSONObject("replay")
    replay.keys().asSequence().toList().forEach { if (replay.getJSONObject(it).getLong("expires") < now) replay.remove(it) }
    val previous = replay.optJSONObject(instance)
    if (previous != null && seq <= previous.getLong("seq") || previous == null && replay.length() >= 128) return false
    replay.put(instance, JSONObject().put("seq", seq).put("expires", maxOf(previous?.getLong("expires") ?: 0, sentAt + ALWAYS_WINDOW_MS)))
    storage.write(hostId, record.toString())
    return true
  }
}
