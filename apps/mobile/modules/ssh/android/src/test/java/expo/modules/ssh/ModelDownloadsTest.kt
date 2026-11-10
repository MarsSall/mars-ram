package expo.modules.ssh

import android.app.DownloadManager
import org.junit.Assert.*
import org.junit.Test

class ModelDownloadsTest {
  @Test fun everyDownloadManagerStatusHasAState() {
    assertEquals("none", modelDownloadState(null))
    assertEquals("pending", modelDownloadState(DownloadManager.STATUS_PENDING))
    assertEquals("running", modelDownloadState(DownloadManager.STATUS_RUNNING))
    assertEquals("paused", modelDownloadState(DownloadManager.STATUS_PAUSED))
    assertEquals("successful", modelDownloadState(DownloadManager.STATUS_SUCCESSFUL))
    assertEquals("failed", modelDownloadState(DownloadManager.STATUS_FAILED))
    assertEquals("failed", modelDownloadState(12345))
  }

  @Test fun aStartAttachesToAKeptDownloadAndReplacesOnlyFailedOrGoneOnes() {
    for (state in listOf("pending", "running", "paused", "successful")) assertTrue(keepsModelDownload(state))
    for (state in listOf("none", "failed")) assertFalse(keepsModelDownload(state))
  }

  @Test fun onlyHttpsAndAPlainFileNameAreDownloaded() {
    val url = "https://huggingface.co/ggml-org/parakeet-GGUF/resolve/35156454d1a39de06863303dd209fd2bed6ee079/ggml-parakeet-tdt-0.6b-v3-q4_0.bin"
    assertTrue(validModelDownload(url, "ggml-parakeet-tdt-0.6b-v3-q4_0.bin"))
    assertFalse(validModelDownload(url.replace("https://", "http://"), "model.bin"))
    for (name in listOf("", "../model.bin", "models/model.bin", ".hidden", "a..b", "model\u0000.bin")) assertFalse(validModelDownload(url, name))
  }

  @Test fun theResultKeepsOnlyRealValues() {
    assertEquals(mapOf("state" to "none", "written" to 0.0, "total" to -1.0, "uri" to null), modelDownloadResult("none"))
    assertEquals(mapOf("state" to "running", "written" to 5.0, "total" to -1.0, "uri" to null), modelDownloadResult("running", 5, 0, "file:///x"))
    assertEquals(mapOf("state" to "successful", "written" to 9.0, "total" to 9.0, "uri" to "file:///x"), modelDownloadResult("successful", 9, 9, "file:///x"))
  }
}
