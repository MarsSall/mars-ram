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
