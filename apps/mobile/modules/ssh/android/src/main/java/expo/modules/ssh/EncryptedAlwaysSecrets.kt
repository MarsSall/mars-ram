package expo.modules.ssh

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One process-wide vault serializes module/service register, replay commits and forgetting. */
internal object AlwaysNotifySecrets {
  private var vault: AlwaysNotifyVault? = null
  @Synchronized fun get(context: Context): AlwaysNotifyVault = vault ?: AlwaysNotifyVault(
    EncryptedAlwaysSecrets(context.applicationContext), { ByteArray(32).also { SecureRandom().nextBytes(it) } }
  ).also { vault = it }
}
private class EncryptedAlwaysSecrets(context: Context) : AlwaysSecretPersistence {
  private val directory = File(context.noBackupFilesDir, "always-notify")
  private val alias = "${context.packageName}.always-notify.aes.v1"
  private fun key(create: Boolean): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    check(create) { "NOTIFY_STORAGE_FAILED" }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        // Intentionally independent of SSH's unlock window; never weakens the SSH key policy.
        .setUserAuthenticationRequired(false).setRandomizedEncryptionRequired(true).build())
    }.generateKey()
  }
  private fun file(hostId: String): AtomicFile {
    val hash = MessageDigest.getInstance("SHA-256").digest(hostId.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
    return AtomicFile(File(directory, "$hash.bin"))
  }
  override fun read(hostId: String): String? {
    val target = file(hostId)
    val input = try { target.openRead() } catch (e: FileNotFoundException) {
      // Access failures are not missing registrations and must never rotate a secret implicitly.
      if (target.baseFile.exists() || File(target.baseFile.path + ".bak").exists()) throw e
      return null
    }
    val bytes = input.use { it.readBytesBounded(131101) }
    check(bytes.size in 29..131100) { "NOTIFY_STORAGE_FAILED" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    cipher.updateAAD(hostId.toByteArray(Charsets.UTF_8))
    return cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
  }
  override fun write(hostId: String, plaintext: String) {
    check(directory.isDirectory || directory.mkdirs()) { "NOTIFY_STORAGE_FAILED" }
    val target = file(hostId)
    check(target.baseFile.exists() || (directory.list()?.size ?: 65) < 64) { "NOTIFY_STORAGE_FAILED" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(hostId.toByteArray(Charsets.UTF_8))
    val data = plaintext.toByteArray(Charsets.UTF_8); check(data.size <= 131072)
    val stream = target.startWrite()
    try { stream.write(cipher.iv); stream.write(cipher.doFinal(data)); target.finishWrite(stream) }
    catch (e: Exception) { target.failWrite(stream); throw e }
  }
  override fun forget(hostId: String) {
    val target = file(hostId)
    target.delete()
    check(listOf("", ".bak", ".new").none { File(target.baseFile.path + it).exists() }) { "NOTIFY_STORAGE_FAILED" }
  }
}
internal fun java.io.InputStream.readBytesBounded(limit: Int): ByteArray {
  val output = java.io.ByteArrayOutputStream()
  val buffer = ByteArray(1024)
  while (output.size() < limit) {
    val count = read(buffer, 0, minOf(buffer.size, limit - output.size()))
    if (count < 0) break
    if (count == 0) throw java.io.IOException()
    output.write(buffer, 0, count)
  }
  return output.toByteArray()
}
