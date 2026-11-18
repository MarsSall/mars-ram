package expo.modules.ssh

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Marks this app's own «Siempre atento» notification taps (release-0.1.8 S5, owner decision L6:
 * «Que las notificaciones propias no pregunten»). Any app can send a `notice` link, so the JS router
 * asks before opening a terminal unless the link carries this install's random secret as `t`.
 * Only this module writes it, in app-private storage; other apps cannot read it. The JS side never
 * logs it, shows it or puts it in a route.
 */
internal interface NoticeTapStore {
  fun read(): String?
  fun write(value: String)
}

private val NOTICE_TAP_MARK = Regex("^[0-9a-f]{64}$")
internal fun isNoticeTapMark(value: String): Boolean = NOTICE_TAP_MARK.matches(value)

internal class NoticeTapTokens(
  private val store: NoticeTapStore,
  private val random: () -> ByteArray = { ByteArray(32).also { SecureRandom().nextBytes(it) } },
) {
  /** The install's mark, created on the first notification that needs one. */
  @Synchronized fun mark(): String {
    store.read()?.takeIf(::isNoticeTapMark)?.let { return it }
    val created = random().joinToString("") { "%02x".format(it) }
    check(isNoticeTapMark(created)) { "notice tap mark must be 32 random bytes" }
    store.write(created)
    return created
  }

  /** Constant-time comparison; never creates a mark, so before any notification nothing is accepted. */
  @Synchronized fun accepts(candidate: String): Boolean {
    val secret = store.read()?.takeIf(::isNoticeTapMark) ?: return false
    if (!isNoticeTapMark(candidate)) return false
    return MessageDigest.isEqual(secret.toByteArray(Charsets.US_ASCII), candidate.toByteArray(Charsets.US_ASCII))
  }

  companion object {
    private const val PREFS = "notice-tap"
    private const val KEY = "mark"
    fun forContext(context: Context): NoticeTapTokens {
      val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return NoticeTapTokens(object : NoticeTapStore {
        override fun read(): String? = prefs.getString(KEY, null)
        // commit(): the mark must be durable before a notification carrying it is posted.
        override fun write(value: String) { prefs.edit().putString(KEY, value).commit() }
      })
    }
  }
}
