package expo.modules.ssh

import net.schmizz.sshj.common.Buffer
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Security
import java.util.Base64

internal object Crypto {
  @Volatile private var ready = false

  /**
   * Android ships a reduced "BC" provider that lacks algorithms sshj needs, so replace it with
   * the full Bouncy Castle, which sshj then uses for key exchange, host keys, and ciphers.
   * Signing with the app's Keystore key goes through [SshConfig] instead, because Bouncy Castle
   * cannot use keys whose private material it cannot read.
   */
  @Synchronized
  fun ensureReady() {
    if (ready) return
    val index = Security.getProviders().indexOfFirst { it.name == BouncyCastleProvider.PROVIDER_NAME }
    if (index != -1) Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
    Security.insertProviderAt(BouncyCastleProvider(), if (index == -1) Security.getProviders().size + 1 else index + 1)
    ready = true
  }

  fun keyBlob(key: PublicKey): ByteArray = Buffer.PlainBuffer().putPublicKey(key).compactData

  /** OpenSSH-style fingerprint, e.g. "SHA256:AbCd1234...". */
  fun fingerprint(key: PublicKey): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(keyBlob(key))
    return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest)
  }

  /** One authorized_keys line for the key. */
  fun authorizedKeysLine(key: PublicKey, comment: String): String {
    val type = net.schmizz.sshj.common.KeyType.fromKey(key).toString()
    return "$type ${Base64.getEncoder().encodeToString(keyBlob(key))} $comment"
  }
}
