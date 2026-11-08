package expo.modules.ssh

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.SignatureException
import java.security.spec.ECGenParameterSpec

/** The app's SSH keys live in the Android Keystore; their private material never leaves it. */
internal object KeystoreKeys {
  private const val PROVIDER = "AndroidKeyStore"
  private const val UNLOCK_VALIDITY_SECONDS = 300

  private fun store(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  fun load(alias: String): KeyPair? {
    val store = store()
    val private = store.getKey(alias, null) as? PrivateKey ?: return null
    return KeyPair(store.getCertificate(alias).publicKey, private)
  }

  /** ECDSA P-256; with requireUnlock, each use needs a device unlock within the validity window. */
  fun create(alias: String, requireUnlock: Boolean): KeyPair {
    val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
      .apply {
        if (requireUnlock) {
          setUserAuthenticationRequired(true)
          setUserAuthenticationParameters(
            UNLOCK_VALIDITY_SECONDS,
            KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
          )
        }
      }
      .build()
    return KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).run {
      initialize(spec)
      generateKeyPair()
    }
  }

  fun delete(alias: String) = store().deleteEntry(alias)

  enum class Usability { READY, UNLOCK_REQUIRED, INVALIDATED }

  sealed interface KeyAccess {
    data class Ready(val pair: KeyPair) : KeyAccess
    data object NeedsUnlock : KeyAccess
    data object Missing : KeyAccess
    data object Invalidated : KeyAccess
  }

  /**
   * For callers without an Activity: use the existing key, never create one or launch a prompt.
   * Android enforces the key's policy: no auth binding, or a still-valid 300-second unlock.
   * This is a preflight, not a cached grant: authentication may expire before SSH signs.
   */
  fun withoutPrompt(alias: String): KeyAccess = try {
    val pair = load(alias)
    if (pair == null) KeyAccess.Missing else when (usability(pair.private)) {
      Usability.READY -> KeyAccess.Ready(pair)
      Usability.UNLOCK_REQUIRED -> KeyAccess.NeedsUnlock
      Usability.INVALIDATED -> KeyAccess.Invalidated
    }
  } catch (_: UserNotAuthenticatedException) {
    KeyAccess.NeedsUnlock
  } catch (_: KeyPermanentlyInvalidatedException) {
    KeyAccess.Invalidated
  }

  sealed interface SignResult {
    data class Signed(val signature: ByteArray) : SignResult
    data object NeedsUnlock : SignResult
    data object Missing : SignResult
    data object Invalidated : SignResult
  }

  /** Signs inside Keystore without UI, including an unlock-window expiry during the operation. */
  fun signWithoutPrompt(alias: String, data: ByteArray): SignResult = try {
    when (val access = withoutPrompt(alias)) {
      KeyAccess.NeedsUnlock -> SignResult.NeedsUnlock
      KeyAccess.Missing -> SignResult.Missing
      KeyAccess.Invalidated -> SignResult.Invalidated
      is KeyAccess.Ready -> {
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(access.pair.private)
        signature.update(data)
        try {
          SignResult.Signed(signature.sign())
        } catch (e: SignatureException) {
          // Some providers wrap an expired auth grant at sign(), rather than initSign().
          when (withoutPrompt(alias)) {
            KeyAccess.NeedsUnlock -> SignResult.NeedsUnlock
            KeyAccess.Invalidated -> SignResult.Invalidated
            KeyAccess.Missing -> SignResult.Missing
            is KeyAccess.Ready -> throw e // Do not mislabel an unrelated crypto failure.
          }
        }
      }
    }
  } catch (_: UserNotAuthenticatedException) {
    SignResult.NeedsUnlock
  } catch (_: KeyPermanentlyInvalidatedException) {
    SignResult.Invalidated
  }

  /**
   * Whether the key can sign right now. Checked before connecting because sshj hides the
   * Keystore's reason when signing fails during authentication.
   */
  fun usability(key: PrivateKey): Usability = try {
    Signature.getInstance("SHA256withECDSA").initSign(key)
    Usability.READY
  } catch (e: UserNotAuthenticatedException) {
    Usability.UNLOCK_REQUIRED
  } catch (e: KeyPermanentlyInvalidatedException) {
    Usability.INVALIDATED
  }
}
