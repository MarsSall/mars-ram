package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

class UploadScopeTest {
  private val root = "/tmp/mars-ram-1000/uploads"
  private val windows = "/C:/Users/dev/AppData/Local/Temp/mars-ram/uploads"

  @Test fun acceptsAbsolutePosixAndSftpWindowsRoots() {
    assertTrue(UploadScope.validRoot(root))
    assertTrue(UploadScope.validRoot(windows))
    assertTrue(UploadScope.validRoot("/tmp/my temp/uploads"))
  }

  @Test fun refusesRelativeRootOrUnsafeComponents() {
    for (bad in listOf("", "/", "tmp/uploads", "/C:", "/C:/", "/tmp//uploads", "/tmp/uploads/", "/tmp/../etc", "/tmp/./x",
      "/tmp/a\\b", "/tmp/a:b/x", "/tmp/x\n", "/tmp/x\u0000", "C:\\Temp\\uploads", "/" + "a".repeat(1100))) {
      assertFalse(bad, UploadScope.validRoot(bad))
    }
  }

  @Test fun directoryIsExactlyTheRoot() {
    assertEquals(root, UploadScope.directory(root, root))
    assertNull(UploadScope.directory("/tmp/mars-ram-1000", root))
    assertNull(UploadScope.directory("$root/x", root))
    assertNull(UploadScope.directory("/tmp/x/../uploads", "/tmp/x/../uploads"))
  }

  @Test fun fileIsOneSafeNameDirectlyInsideTheRoot() {
    assertEquals("$root/a.png", UploadScope.file("$root/a.png", root))
    assertEquals("$root/a.png.part", UploadScope.file("$root/a.png.part", root))
    assertEquals("$windows/a.png", UploadScope.file("$windows/a.png", windows))
    for (bad in listOf(root, "$root/", "$root/..", "$root/.", "$root/x/a.png", "$root/a\\b", "$root/a:b", "${root}x/a.png", "/etc/passwd", "uploads/a.png")) {
      assertNull(bad, UploadScope.file(bad, root))
    }
    assertNull(UploadScope.file("/tmp/../a.png", "/tmp/.."))
  }

  @Test fun withoutARootOnlyHomeRelativePathsPass() {
    assertTrue(UploadScope.relative(".mars-ram/links/.staging"))
    assertFalse(UploadScope.relative(root))
  }
}
