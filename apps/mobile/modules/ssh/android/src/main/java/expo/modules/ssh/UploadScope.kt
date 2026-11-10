package expo.modules.ssh

/**
 * Absolute SFTP access is limited to the uploads folder the host CLI reported for this
 * connection (`uploads-dir --json`), passed explicitly as root. Relative paths keep their
 * home-relative behavior; an absolute path without a root is refused.
 */
internal object UploadScope {
  private val drive = Regex("^[A-Za-z]:$")

  private fun safeName(name: String) =
    name.isNotEmpty() && name != "." && name != ".." && name.none { it == '/' || it == '\\' || it == ':' || it < ' ' || it == '\u007f' }

  /** POSIX `/tmp/x/uploads` or SFTP Windows `/C:/Users/x/uploads`; never `/`, a bare drive, `..` or empty components. */
  fun validRoot(root: String): Boolean {
    if (!root.startsWith('/') || root.length > 1024) return false
    val parts = root.substring(1).split('/')
    val windows = drive.matches(parts.first())
    val names = if (windows) parts.drop(1) else parts
    return names.isNotEmpty() && names.all(::safeName)
  }

  /** The directory to list or upload into: exactly the root. */
  fun directory(path: String, root: String): String? = if (path == root && validRoot(root)) root else null

  /** A file directly inside the root, never deeper and never the root itself. */
  fun file(path: String, root: String): String? {
    if (!validRoot(root) || !path.startsWith("$root/")) return null
    return if (safeName(path.substring(root.length + 1))) path else null
  }

  /** Without a root, only home-relative paths are accepted. */
  fun relative(path: String): Boolean = !path.startsWith('/')
}
