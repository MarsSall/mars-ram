package expo.modules.ssh

import org.junit.Assert.*
import org.junit.Test

class TerminalCommandTest {
  @Test fun emptyCommandIsTheLoginShell() {
    assertTrue(TerminalCommand.allowed(emptyList()))
  }

  @Test fun herdrPathsAndSessionsStayAllowed() {
    for (path in listOf("herdr", "/home/dev/.local/bin/herdr", "/opt/my tools/herdr.exe", "C:\\Program Files\\Herdr\\herdr.exe")) {
      assertTrue(path, TerminalCommand.allowed(listOf(path)))
      assertTrue(path, TerminalCommand.allowed(listOf(path, "--session", "main.1_a-b")))
    }
  }

  @Test fun everythingElseIsRejected() {
    for (command in listOf(
      listOf(""), listOf("sh"), listOf("/bin/bash"), listOf("bash", "-l"), listOf("herdr.exe"), listOf("./herdr"),
      listOf("/bin/herdr;id"), listOf("/bin/../herdr"), listOf("C:\\..\\herdr.exe"), listOf("/bin/herdr\n"), listOf("/bin/\$(id)/herdr"),
      listOf("herdr", "extra"), listOf("herdr", "--session"), listOf("herdr", "--session", "a b"), listOf("herdr", "--session", "-x"),
      listOf("herdr", "--session", "a".repeat(65)), listOf("herdr", "--other", "main"), listOf("herdr", "--session", "main", "extra"),
    )) assertFalse(command.toString(), TerminalCommand.allowed(command))
  }

  @Test fun blankOrPaddedPartsAreRejected() {
    for (command in listOf(
      listOf(" "), listOf("\t"), listOf("\n"), listOf(" ", " "), listOf(" herdr"), listOf("herdr "), listOf("/usr/bin/herdr "),
      listOf("herdr", " "), listOf("herdr", "--session", " "), listOf("herdr", "--session", "main "), listOf("herdr", "--session", "\t"),
    )) assertFalse(command.toString(), TerminalCommand.allowed(command))
  }

  @Test fun windowsPathsAreDriveLetterPaths() {
    assertTrue(TerminalCommand.windowsPath("C:\\Herdr\\herdr.exe"))
    assertFalse(TerminalCommand.windowsPath("/usr/bin/herdr"))
    assertFalse(TerminalCommand.windowsPath("herdr"))
  }
}
