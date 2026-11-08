package expo.modules.ssh

import android.security.keystore.UserNotAuthenticatedException
import net.schmizz.sshj.userauth.UserAuthException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeoutException

internal enum class Stage { CONNECTING, AUTHENTICATING, CONNECTED }
internal const val UNLOCK_MESSAGE = "Unlock the phone to use the SSH key."

internal fun failure(code: String, message: String, extra: Map<String, Any?> = emptyMap()) =
  mapOf("ok" to false, "code" to code, "message" to message) + extra

internal fun notConnected() = failure("NOT_CONNECTED", "The connection is closed. Connect again.")

internal fun classify(e: Exception, stage: Stage, address: String, port: Int, username: String): Map<String, Any?> {
  val cause = rootCause(e)
  val timedOut = cause is TimeoutException || cause is SocketTimeoutException
  return when {
    cause is UserNotAuthenticatedException -> failure("UNLOCK_REQUIRED", UNLOCK_MESSAGE)
    cause is UnknownHostException -> failure("HOST_NOT_FOUND", "Cannot resolve $address. Check that the phone is on the tailnet.")
    stage == Stage.CONNECTING && (timedOut || cause is ConnectException || cause is NoRouteToHostException) ->
      failure("UNREACHABLE", "Cannot reach $address:$port. Check that the phone is on the tailnet and the host is on.")
    timedOut -> failure("TIMEOUT", "The host stopped responding for ${SshConfig.CHANNEL_READ_TIMEOUT_MS / 1000} seconds.")
    e is UserAuthException ->
      failure("AUTH_FAILED", "The host did not accept the app's key for $username.", mapOf("detail" to describe(e)))
    else -> failure("SSH_ERROR", cause.message ?: cause.javaClass.simpleName)
  }
}

/** Exception chain, including suppressed causes, for diagnosing failures sshj wraps. */
private fun describe(e: Throwable): String {
  val parts = mutableListOf<String>()
  var current: Throwable? = e
  while (current != null && parts.size < 8) {
    parts += "${current.javaClass.simpleName}: ${current.message}"
    current.suppressed.take(2).forEach { parts += "suppressed ${it.javaClass.simpleName}: ${it.message}" }
    current = current.cause.takeIf { it !== current }
  }
  return parts.take(8).joinToString(" <- ").take(1_000)
}

/** Deepest cause, stopping if the cause chain loops. */
private fun rootCause(e: Throwable): Throwable {
  val seen = mutableSetOf<Throwable>()
  var current = e
  while (seen.add(current)) current = current.cause ?: break
  return current
}
