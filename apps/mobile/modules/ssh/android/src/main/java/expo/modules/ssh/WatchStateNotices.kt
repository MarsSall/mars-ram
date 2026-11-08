package expo.modules.ssh

internal data class WatchNotificationKey(val tag: String?, val id: Int)

/** Transient watch state only; delivered session alerts are never selected. */
internal fun watchStateNoticesToCancel(notices: List<WatchNotificationKey>, recoveredHost: String? = null): List<WatchNotificationKey> = notices.filter { notice ->
  if (recoveredHost != null) {
    notice.id == 7201 && notice.tag in setOf("unlock:$recoveredHost", "lost:$recoveredHost")
  } else {
    (notice.tag == null && notice.id == 7200) ||
      (notice.id == 7201 && (notice.tag?.startsWith("unlock:") == true || notice.tag?.startsWith("lost:") == true))
  }
}
