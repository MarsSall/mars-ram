package expo.modules.ssh

/** Registry projection; deliberately not a data class so diagnostics cannot stringify its token. */
internal class WatchRegistration(
  val id: String, val sessionId: String, val port: Int, val token: String,
  val cwd: String, val protocolVersion: String,
) {
  val project: String get() = (cwd.split('/', '\\').lastOrNull { it.isNotEmpty() } ?: "Project")
    .filterNot { it.isISOControl() }.take(120)
}

/** Mirrors RegistryEntry + checkCompatibility in packages/protocol; ignores additive fields.
 * Parsed JSON values enter here without JSONObject's optString coercion. Transport/notification
 * restrictions are NOT wire-schema constraints (in particular IDs and tokens are arbitrary strings).
 */
internal fun decodeWatchRegistration(value: Any?): WatchRegistration? {
  val json = value as? Map<*, *> ?: return null
  val version = json["protocolVersion"] as? String ?: return null
  if (!compatibleWatchProtocol(version)) return null
  val id = json["bridgeInstanceId"] as? String ?: return null
  val session = json["sessionId"] as? String ?: return null
  val port = (json["port"] as? Number)?.toDouble() ?: return null
  val pid = (json["pid"] as? Number)?.toDouble() ?: return null
  val token = json["token"] as? String ?: return null
  val cwd = json["cwd"] as? String ?: return null
  val startedAt = (json["startedAt"] as? Number)?.toDouble() ?: return null
  if (id.isEmpty() || session.isEmpty() || !port.isFinite() || port !in 1.0..65535.0 || port % 1 != 0.0 ||
    !pid.isFinite() || pid < 1 || pid % 1 != 0.0 || token.codePointCount(0, token.length) < 32 || !startedAt.isFinite()) return null
  return WatchRegistration(id, session, port.toInt(), token, cwd, version)
}

internal fun compatibleWatchProtocol(version: String): Boolean =
  Regex("[0-9]+\\.[0-9]+").matches(version) && version.substringBefore('.').trimStart('0') == "1"

internal fun legacyWatchOutcomes(version: String): Boolean {
  if (!compatibleWatchProtocol(version)) return false
  val minor = version.substringAfter('.').trimStart('0')
  return minor.isEmpty() || (minor.length == 1 && minor[0] < '6')
}

/** Notification extras carry opaque, lossless UTF-16 hex, NOT a path or URI. T3 must decode once.
 * Unlike UTF-8 URL encoding this also preserves lone surrogate code units allowed by JSON strings.
 * Apply only at the Android boundary: never use this as a registry ID validator or dedup key.
 */
internal fun notificationWatchId(id: String): String = id.map { it.code.toString(16).padStart(4, '0') }.joinToString("")
