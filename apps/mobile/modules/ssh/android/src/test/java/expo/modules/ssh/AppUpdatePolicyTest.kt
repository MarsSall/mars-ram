package expo.modules.ssh

import com.google.android.play.core.install.model.ActivityResult
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import org.junit.Assert.*
import org.junit.Test

class AppUpdatePolicyTest {
  private fun info(availability: Int, status: Int = InstallStatus.UNKNOWN, versionCode: Int = 9, flexible: Boolean = true) =
    PlayUpdateInfo(availability, status, versionCode, flexible)

  @Test fun failuresAndMissingPlayAreNotAvailable() {
    assertEquals(mapOf("available" to false), appUpdateResult(null, 8))
  }

  @Test fun flexibleUpdateFromPlayIsAvailableWithItsVersionCode() {
    assertEquals(mapOf("available" to true, "versionCode" to 9, "downloaded" to false), appUpdateResult(info(UpdateAvailability.UPDATE_AVAILABLE), 8))
  }

  @Test fun nothingNewOrUnknownOrNotFlexibleIsNotAvailable() {
    for (availability in listOf(UpdateAvailability.UPDATE_NOT_AVAILABLE, UpdateAvailability.UNKNOWN)) {
      assertEquals(mapOf("available" to false), appUpdateResult(info(availability), 8))
    }
    assertEquals(mapOf("available" to false), appUpdateResult(info(UpdateAvailability.UPDATE_AVAILABLE, flexible = false), 8))
  }

  @Test fun anUpdateThatIsNotNewerThanThisBuildIsIgnored() {
    assertEquals(mapOf("available" to false), appUpdateResult(info(UpdateAvailability.UPDATE_AVAILABLE, versionCode = 8), 8))
    assertEquals(mapOf("available" to true, "versionCode" to 9, "downloaded" to false), appUpdateResult(info(UpdateAvailability.UPDATE_AVAILABLE), null))
  }

  @Test fun aDownloadedUpdateOffersRestartEvenWhileAnotherFlowRuns() {
    for (availability in listOf(UpdateAvailability.UPDATE_AVAILABLE, UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS)) {
      assertEquals(mapOf("available" to true, "versionCode" to 9, "downloaded" to true), appUpdateResult(info(availability, InstallStatus.DOWNLOADED, flexible = false), 8))
    }
  }

  @Test fun aDownloadInProgressIsAvailableButNotDownloaded() {
    assertEquals(mapOf("available" to true, "versionCode" to 9, "downloaded" to false),
      appUpdateResult(info(UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS, InstallStatus.DOWNLOADING), 8))
  }

  @Test fun onlyAcceptedPromptsStartTheDownload() {
    assertEquals(mapOf("started" to true, "downloaded" to false), startResult(-1))
    assertEquals(mapOf("started" to false, "downloaded" to false), startResult(0))
    assertEquals(mapOf("started" to false, "downloaded" to false), startResult(ActivityResult.RESULT_IN_APP_UPDATE_FAILED))
    assertEquals(mapOf("started" to false, "downloaded" to false), startResult(null))
  }

  @Test fun aDownloadThatEndsTellsJsHowAndStopsListening() {
    assertEquals("downloaded", installEvent(InstallStatus.DOWNLOADED))
    assertEquals("failed", installEvent(InstallStatus.FAILED))
    assertEquals("canceled", installEvent(InstallStatus.CANCELED))
    for (status in listOf(InstallStatus.PENDING, InstallStatus.DOWNLOADING, InstallStatus.INSTALLING, InstallStatus.INSTALLED, InstallStatus.UNKNOWN)) assertNull(installEvent(status))
    for (status in listOf(InstallStatus.DOWNLOADED, InstallStatus.INSTALLED, InstallStatus.FAILED, InstallStatus.CANCELED)) assertTrue(stopsListening(status))
    for (status in listOf(InstallStatus.PENDING, InstallStatus.DOWNLOADING, InstallStatus.INSTALLING)) assertFalse(stopsListening(status))
  }

  @Test fun theCurrentDownloadIsReportedWhateverTheCachedCheck() {
    assertEquals("none", installProgress(null))
    assertEquals("downloaded", installProgress(info(UpdateAvailability.UPDATE_AVAILABLE, InstallStatus.DOWNLOADED)))
    assertEquals("downloaded", installProgress(info(UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS, InstallStatus.DOWNLOADED)))
    for (status in listOf(InstallStatus.PENDING, InstallStatus.DOWNLOADING)) {
      assertEquals("downloading", installProgress(info(UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS, status)))
    }
    for (status in listOf(InstallStatus.UNKNOWN, InstallStatus.FAILED, InstallStatus.CANCELED, InstallStatus.INSTALLED)) {
      assertEquals("none", installProgress(info(UpdateAvailability.UPDATE_AVAILABLE, status)))
    }
  }

  @Test fun onlyPlayInstallsAskPlay() {
    assertTrue(isPlayInstall("com.android.vending"))
    for (installer in listOf(null, "", "com.android.shell", "com.google.android.packageinstaller", "com.android.vending.fake")) assertFalse(isPlayInstall(installer))
  }

  @Test fun appBuildKeepsOnlyRealValues() {
    assertEquals(mapOf("versionCode" to 8L, "versionName" to "1.0.0"), appBuildInfo(8L, " 1.0.0 "))
    assertEquals(mapOf("versionCode" to null, "versionName" to null), appBuildInfo(0L, ""))
    assertEquals(mapOf("versionCode" to null, "versionName" to null), appBuildInfo(null, null))
  }
}
