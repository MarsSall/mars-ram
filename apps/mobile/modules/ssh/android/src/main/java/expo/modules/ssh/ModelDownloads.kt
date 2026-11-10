package expo.modules.ssh

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import java.io.File

private const val PREFS = "model_download"
private const val KEY_ID = "id"
/** The system download's file name: never the model's own, which lives in the app's private folder. */
private const val SUFFIX = ".download"
private const val MAX_TEXT = 200

/** DownloadManager's status of the kept download; null is a download the system no longer has. */
internal fun modelDownloadState(status: Int?): String = when (status) {
  null -> "none"
  DownloadManager.STATUS_PENDING -> "pending"
  DownloadManager.STATUS_RUNNING -> "running"
  DownloadManager.STATUS_PAUSED -> "paused"
  DownloadManager.STATUS_SUCCESSFUL -> "successful"
  else -> "failed"
}

/** A start returns these instead of starting a second download; failed or gone ones are replaced. */
internal fun keepsModelDownload(state: String): Boolean = state in setOf("pending", "running", "paused", "successful")

/** Only https, and a plain file name: no folders, no way out of the app's files folder. */
internal fun validModelDownload(url: String, fileName: String): Boolean =
  url.startsWith("https://") && url.length <= 2048 && !fileName.contains("..") &&
    Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}").matches(fileName)

/** written never negative; total is -1 until the server reports it; uri only once finished. */
internal fun modelDownloadResult(state: String, written: Long = 0, total: Long = -1, uri: String? = null): Map<String, Any?> = mapOf(
  "state" to state,
  "written" to written.coerceAtLeast(0).toDouble(),
  "total" to (if (total > 0) total else -1L).toDouble(),
  "uri" to if (state == "successful") uri else null,
)

/**
 * The voice model's download through Android's DownloadManager: the system keeps it going when
 * the app is closed, shows its progress in a notification and resumes it after interruptions.
 * It writes to the app's external files folder, which needs no storage permission, and its id is
 * kept in SharedPreferences so a later run finds it again. One download at a time.
 */
internal class ModelDownloads(context: Context) {
  private val context = context.applicationContext
  private val manager = this.context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
  private val prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  @Synchronized fun status(): Map<String, Any?> {
    val id = prefs.getLong(KEY_ID, -1L)
    if (id < 0) return modelDownloadResult("none")
    // An unreadable DownloadManager is a failure; JS then cancels, which forgets the id.
    val result = runCatching { query(id) }.getOrElse { return modelDownloadResult("failed") }
    if (result["state"] == "none") forget()
    return result
  }

  @Synchronized fun start(url: String, fileName: String, title: String, description: String): Map<String, Any?> {
    if (!validModelDownload(url, fileName)) return modelDownloadResult("failed")
    val kept = status()
    if (keepsModelDownload(kept["state"] as String)) return kept
    cancel()
    return runCatching {
      val folder = context.getExternalFilesDir(null) ?: return modelDownloadResult("failed")
      val name = fileName + SUFFIX
      // A file left by an earlier run would make DownloadManager pick another name.
      File(folder, name).delete()
      val request = DownloadManager.Request(Uri.parse(url))
        .setTitle(title.take(MAX_TEXT))
        .setDescription(description.take(MAX_TEXT))
        .setMimeType("application/octet-stream")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(true)
        .setDestinationInExternalFilesDir(context, null, name)
      val id = manager.enqueue(request)
      prefs.edit().putLong(KEY_ID, id).commit()
      query(id)
    }.getOrElse { modelDownloadResult("failed") }
  }

  /** DownloadManager.remove stops the download and deletes its file and notification. */
  @Synchronized fun cancel() {
    val id = prefs.getLong(KEY_ID, -1L)
    if (id >= 0) runCatching { manager.remove(id) }
    forget()
  }

  private fun forget() { prefs.edit().remove(KEY_ID).commit() }

  private fun query(id: Long): Map<String, Any?> =
    manager.query(DownloadManager.Query().setFilterById(id))?.use { row ->
      if (!row.moveToFirst()) return@use modelDownloadResult("none")
      modelDownloadResult(
        modelDownloadState(row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))),
        row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
        row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
        row.getString(row.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)),
      )
    } ?: modelDownloadResult("none")
}
