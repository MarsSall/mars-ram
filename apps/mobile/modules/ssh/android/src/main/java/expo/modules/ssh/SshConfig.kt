package expo.modules.ssh

import com.hierynomus.sshj.key.KeyAlgorithm
import net.schmizz.keepalive.KeepAliveProvider
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.common.Factory
import net.schmizz.sshj.signature.Signature
import java.security.PrivateKey
import java.security.PublicKey

/** sshj configuration whose ECDSA P-256 signing can use the app's Android Keystore key. */
internal object SshConfig {
  private const val APP_KEY_ALGORITHM = "ecdsa-sha2-nistp256"

  /** How long a read from an open channel may wait before the operation fails. */
  const val CHANNEL_READ_TIMEOUT_MS = 30_000

  /** Keep-alive interval; a link that stops answering is detected and closed. */
  const val KEEP_ALIVE_SECONDS = 15

  fun create(): DefaultConfig = DefaultConfig().apply {
    // sshj waits forever on channel reads by default; a stalled command or network must fail.
    channelReadTimeoutMs = CHANNEL_READ_TIMEOUT_MS
    channelErrorReadTimeoutMs = CHANNEL_READ_TIMEOUT_MS
    keepAliveProvider = KeepAliveProvider.KEEP_ALIVE
    keyAlgorithms = keyAlgorithms.map { factory ->
      if (factory.name != APP_KEY_ALGORITHM) factory
      else object : Factory.Named<KeyAlgorithm> {
        override fun getName() = factory.name
        override fun create(): KeyAlgorithm = PlatformSigningKeyAlgorithm(factory.create(), "SHA256withECDSA")
      }
    }
  }
}

private class PlatformSigningKeyAlgorithm(private val inner: KeyAlgorithm, private val jcaAlgorithm: String) : KeyAlgorithm by inner {
  override fun newSignature(): Signature = PlatformSigning(inner.newSignature(), jcaAlgorithm)
}

/**
 * Signs through the platform's provider selection, which routes Android Keystore keys to the
 * Keystore. Verifying and encoding stay with sshj's own implementation.
 */
private class PlatformSigning(private val inner: Signature, private val jcaAlgorithm: String) : Signature by inner {
  private var signer: java.security.Signature? = null

  override fun initSign(key: PrivateKey) {
    signer = java.security.Signature.getInstance(jcaAlgorithm).apply { initSign(key) }
  }

  override fun initVerify(key: PublicKey) {
    signer = null
    inner.initVerify(key)
  }

  override fun update(data: ByteArray) {
    val current = signer
    if (current != null) current.update(data) else inner.update(data)
  }

  override fun update(data: ByteArray, offset: Int, length: Int) {
    val current = signer
    if (current != null) current.update(data, offset, length) else inner.update(data, offset, length)
  }

  override fun sign(): ByteArray = signer?.sign() ?: inner.sign()
}
