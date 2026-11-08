package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

class AlwaysNotifyVaultTest {
  private class Fake : AlwaysSecretPersistence {
    val rows = mutableMapOf<String, String>()
    override fun read(hostId: String) = rows[hostId]
    override fun write(hostId: String, plaintext: String) { rows[hostId] = plaintext }
    override fun forget(hostId: String) { rows.remove(hostId) }
  }
  @Test fun perComputerStableSecretForgetAndNoImplicitCreation() {
    val disk = Fake(); var random = 0
    val vault = AlwaysNotifyVault(disk) { ByteArray(32) { (++random).toByte() } }
    assertNull(vault.secret("one"))
    val one = vault.register("one")
    assertEquals(one, vault.register("one"))
    assertNotEquals(one, vault.register("two"))
    vault.forget("one")
    assertNull(vault.secret("one"))
    assertNotEquals(one, vault.register("one"))
    assertEquals(32, vault.secret("two")!!.size)
  }
  @Test fun forgottenOrRotatedSecretCannotCommitAnInFlightNotice() {
    val disk = Fake(); var generation = 0
    val vault = AlwaysNotifyVault(disk) { ByteArray(32) { generation.toByte() } }
    vault.register("one"); val old = vault.secret("one")!!
    vault.forget("one"); generation++; vault.register("one")
    assertFalse(vault.acceptReplay("one", "instance", 1, 1800000000000, 1800000000000, expectedSecret = old))
  }
  @Test fun replaySurvivesVerifierAndVaultRecreationAndFailsClosed() {
    val disk = Fake(); val vault = AlwaysNotifyVault(disk) { ByteArray(32) }
    vault.register("one")
    assertTrue(vault.acceptReplay("one", "instance", 7, 1800000000000, 1800000000000))
    assertFalse(AlwaysNotifyVault(disk) { ByteArray(32) }.acceptReplay("one", "instance", 7, 1800000000000, 1800000000000))
    assertTrue(vault.acceptReplay("one", "other", 1, 1800000000000, 1800000000000))
    assertFalse(vault.acceptReplay("absent", "instance", 1, 1800000000000, 1800000000000))
    vault.forget("one")
    assertFalse(vault.acceptReplay("one", "instance", 8, 1800000000000, 1800000000000))
  }
}
