# Guided session shortcuts: host commands

The paired phone can list repositories and open **Gentle Shell, Pi or OpenCode** in Herdr. It cannot supply an arbitrary command or program arguments through these commands. This is not an SSH sandbox: the paired key already permits interactive Herdr terminals.

## Read the installed host release

`mars-ram version` prints a release such as `0.2.0`; `mars-ram version --json` prints exactly one bounded line:

```json
{"version":1,"release":"0.2.0"}
```

Both exit 0, without prompts, network or changes. Only the optional `--json` flag is accepted; other/duplicate arguments exit 2 with usage. The envelope `version: 1` is separate from both the release and the bridge protocol. A checkout with no valid release metadata prints `dev` (or `{"version":1,"release":"dev"}`), not an error.

`host/cli/scripts/build-release.ts` embeds `cli/VERSION` in the archive; `buildCliCopy` carries it through installation and subsequent reinstalls into `~/.mars-ram/cli/VERSION`. The phone invokes the absolute recorded Node and `cli/src/main.ts` paths, with the same conservative POSIX/cmd quoting as the Herdr switcher, so the result does not depend on SSH PATH or npm launcher variables. The bridge source fingerprint in `install.json` is unchanged.

The phone warns prominently below its `MINIMUM_HOST_VERSION` (`apps/mobile/src/core/host-update.ts`, now **0.1.6**: it was 0.1.4, the first release with `version --json`, became 0.1.5 because attachments need `mars-ram uploads-dir` and ZeroTier pairing needs `mars-ram pair-zt`, and became 0.1.6 because private links and Siempre atento over ZeroTier, and the project browser's refusal of hard links, first shipped in 0.1.6; bump only when newly required host functionality needs it). A CLI without `version --json` (0.1.3 or older) always counts as below the minimum. An older CLI's nonzero/usage response is treated as legacy, without breaking sessions; transport failures and malformed successful responses are unknown, not evidence of an old release. `dev` never warns. A validated newer npm release gives only a subtle optional notice. The copyable remedy is `mars-ram update` for a host of 0.1.7 or later (`FIRST_HOST_WITH_UPDATE_COMMAND`), otherwise `pnpm add -g mars-ram@<target>` followed by `mars-ram install`, run in the **computer's terminal**, on Linux or Windows. From 0.1.8, `mars-ram update` ends, after a successful `mars-ram install` of the new version, by running that version's `mars-ram doctor` (on Windows in the window the update continues in) and printing one line that it ran; the doctor's exit code never changes the update's, and a failed update or install does not run it. The update runs the code of the version that starts it, so going from 0.1.7 to 0.1.8 does not run doctor yet. A still-running session with an older compatible bridge protocol minor gets a separate `/reload` hint.

## Windows without administrator

`sshd_config`, `administrators_authorized_keys` and the SSH host key under `C:\ProgramData\ssh` are readable only by administrators. In a window that is not elevated (detected with the same `whoami /groups` SIDs that make `mars-ram install` and `mars-ram update` refuse elevated windows), `mars-ram doctor` keeps the SSH TCP forwarding and paired-keys findings as warnings but says those files are readable only by administrators and to run `mars-ram doctor` as administrator to check them; the paired-keys explanation applies only when the user's keys live in `administrators_authorized_keys` (members of Administrators). `mars-ram pair` says it needs an administrator window when the host key exists but cannot be read; a missing key keeps «Is the SSH server installed?». Elevated windows and Linux keep the previous messages.

## Windows ACL check

On Windows, `mars-ram doctor` reads the ACL of `%USERPROFILE%\.mars-ram` by SID with a bounded, read-only PowerShell script (paths passed as base64 data, at most 32 paths per call and 1,024 in total, each call with the 10-second limit; `Get-Item -Force` type and `ReparsePoint` attribute, `Get-Acl` owner, protection and Allow entries with their `FileSystemRights`). Only the folders that hold secrets are required to be private: `agents` (agent hook tokens), `bridges` (bridge tokens), `links` (link copies, tokens and server identity records), `notify` (per-phone notification secrets) and the bridge registry folder the bridges actually use, resolved as they do (`PI_BRIDGE_REGISTRY_DIR` from doctor's environment, else `~/.mars-ram/bridges`). Their writers restrict nested records one by one (the hook token is the content of the marker in `agents\<prefix>-<session>.lock\<marker>`; each link keeps `link.json` and `content` in `links\<id>\`), so doctor walks every descendant of each secret folder, level by level, listing a folder only after PowerShell says it is a directory and not a reparse point. The root is read first and alone: a root that is a reparse point or not a directory is a problem and nothing under it is probed, listed or read; a secret folder that is a reparse point or not a directory is a problem too and is never listed. Each secret folder that exists and every descendant must be owned by the user, SYSTEM or Administrators and allow only those SIDs; a reparse point (junction, symlink, mount point) is unsafe and never followed; a secret folder under the root that inherits its ACL from a root with other entries is unsafe too, and a registry folder outside `~/.mars-ram` must also have a protected ACL. A `PI_BRIDGE_REGISTRY_DIR` that is not fully qualified (a drive path `X:\...` or a UNC share `\\server\share\...`; so relative, empty, drive-less `\path` or `C:path`) depends on each bridge's working folder or drive and is unsafe. When it names `%USERPROFILE%\.mars-ram` itself (compared normalized and case-insensitively), the root holds tokens: it is judged as a secret folder (only the user, SYSTEM and Administrators, protected) with every descendant, so any other reader on it is a problem, not the warning below. A path PowerShell reports as missing counts as gone only when an `lstat` re-check also finds nothing; one that is there after all, and any result other than exactly `{missing: true}` or a well-formed ACL (an error, or missing mixed with an ACL or an error), is unsafe. Any of these prints `problem: Mars-RAM ACL and owner: unsafe.`, as does a root owned by another account or a root entry for another account with any right beyond read and execute (write, delete, change permissions, take ownership or generic write/all; allowed mask `0xA01200A9`). When the walk would pass 1,024 paths, doctor stops reading and prints `problem: Mars-RAM ACL and owner: too many entries to check.` with a fix to check those folders by hand; it is never reported as ok. The bridge-registry check that runs first in `mars-ram doctor` also never follows links on Windows: when `%USERPROFILE%\.mars-ram` or its `bridges` folder is a symlink, junction or not a folder, a `bridges` entry is a symlink or junction, or any folder on the way to a `PI_BRIDGE_REGISTRY_DIR` override (each component from below its drive or UNC share root down to the registry folder itself, inside or outside `%USERPROFILE%\.mars-ram`, checked with `lstat` after the root) is a symlink, junction or not a folder, it prints `problem: Bridge registry path is a link, reparse point or not a folder, so doctor did not read it: <path>.` and does not list or read it (Node's `lstat` reports symlinks and junctions).

Known follow-ups: a folder or file could be swapped between a check and the next listing or read; the folders above `%USERPROFILE%\.mars-ram` itself are not checked for links (with `PI_BRIDGE_REGISTRY_DIR` equal to the root and a linked profile folder, doctor reports the problem but still reads the root); and the folder walk of a registry override uses Node's link detection, which may miss reparse-point kinds Node does not report as links. These need someone who can already write as the user; doctor is a diagnostic and the writers restrict the files themselves.

Code, logs and settings (`bin`, `cli`, `pi-bridge`, `link-server`, `logs`, `host.json`, `install.json`, the hooks records) are judged only through the root. When other accounts can only read and execute it, doctor prints a warning naming them instead of a problem, for example: `warning: Other accounts can read Mars-RAM's code and settings (MARS\CodexSandboxUsers, added by Codex's sandbox). Tokens and links stay private.` Codex's Windows sandbox adds that read entry to `%USERPROFILE%` and `%USERPROFILE%\.mars-ram` each time it starts, so the fix only says there is nothing to fix; for any other account it says to remove the entry in the Windows Security advanced permissions if it was not added on purpose. Linux and macOS keep the `bridges` mode check (0700 folder, 0600 entries).

## Always-attentive notification registration (host foundation)

Run through the paired phone's authenticated SSH connection:

```text
mars-ram notify register --json   # stdin: {"secret":"<64 lowercase hex chars>","port":47812}
mars-ram notify status --json
mars-ram notify unregister
```

Never put the secret in arguments, shell history or logs. Registration reads at
most 1024 bytes of stdin with a five-second input deadline. It accepts exactly
`secret` (32 random bytes encoded as lowercase hex) and integer `port` (1–65535).
The destination comes only from `SSH_CONNECTION` / `SSH_CLIENT` source IP, not
stdin. Missing, conflicting or non-Tailscale addresses are refused. Allowed
literal ranges are `100.64.0.0/10` and `fd7a:115c:a1e0::/48`; no DNS or mapped IPs.

Each phone IP has one record under `~/.mars-ram/notify/` (0700 directory, 0600
files; existing current-user ACL adapter on Windows). Different phones do not
rewrite a shared index. Re-registering replaces that address's record atomically;
unregister removes only that caller's address. Status never returns the secret.
Results are a bounded single JSON line: `{v:1,ok:true,hostKeyId,port}` for register,
`{v:1,ok:true,registered,...}` for status and `{v:1,ok:true}` for unregister.
Errors return `{v:1,ok:false,code:"NOTIFY_FAILED"}`, exit 1. If server startup
fails after persistence, status may still show the registration; retry enabling
or unregister. The host must already have the normal host installation.

Registration ensures the existing link server is running. At least one valid
phone record keeps it alive without valid links. Removing the last phone restores
the normal link-expiry shutdown; no permanent service or login startup is added.
Doctor warns when records exist without a confirmed server listener. The host
process must remain running; reboot, stop, or process death stops notices until
it is ensured again.

The server polls the local bridge registry every 30 seconds (1000 directory
entries, 64 KiB per entry, at most 128 watched instances); it validates registry
shape/protocol and liveness, then follows authenticated loopback state/events.
Snapshots and replay-gap resnapshots are silent. Prompt start means needs-answer;
completed/failed settles map to finished/failed. Aborts and unknown outcomes are
silent; absent outcome means finished only below bridge protocol 1.6. Sequence
cursors deduplicate within each instance. Bridge tokens never leave the host.
Only project basename and state enter notices, never paths or agent content.

Delivery has no persistent queue: at most 16 in-flight fan-outs, four TCP sends
per fan-out, three attempts per phone with 2-second deadlines and 250/500 ms
retry delays. Overload and persistent failures drop notices. Registrations are
not deleted on delivery failure. Unregister cannot retract an already in-flight
notice. This host foundation does not yet enable the phone's ALWAYS listener;
UI, battery/Doze and native Windows/device checks remain follow-up work.

## Choose repository roots on the computer

```text
mars-ram repos --json
mars-ram repos --add-root /absolute/projects
mars-ram repos --remove-root /absolute/projects
```

On Windows use an absolute drive path, for example `C:\Users\you\Work`. Root edits require an interactive local terminal (stdin and stdout TTY, no SSH connection markers); SSH and non-interactive invocations return `LOCAL_ONLY`. This check prevents accidental remote configuration, not a hostile same-user SSH client from clearing its environment or editing the file directly.

Roots live in `repoRoots: string[]` in `~/.mars-ram/host.json` (`%USERPROFILE%\.mars-ram\host.json` on Windows). Existing fields are preserved. When `host.json` does not exist, or exists without `repoRoots`, the default is `~/Work` if it is a directory (otherwise there are no roots). A malformed `host.json` (invalid JSON, not an object, over 1 MiB, or a `repoRoots` that is not an array of absolute paths) is an error: nothing is discovered and nothing falls back to `~/Work`. An explicit `"repoRoots": []` disables discovery. Missing roots are skipped. Removing the last root persists `[]`, not the default.

Discovery includes the root itself and at most three directory levels below it. A `.git` file (worktrees) or directory marks a repo. A configured root that is itself a symlink is resolved to its target, and that target is the root. Below a root it does not follow directory symlinks/junctions. It does not execute Git, read repository content, descend into repos, or enter dot-prefixed folders or `node_modules`. `.git` symlinks are not accepted. Results have canonical absolute paths, folder names, and canonical roots; overlapping roots are deduplicated, ordering is deterministic. Limits are 500 results and 20,000 visited directories; reaching a bound sets `truncated`. Unreadable roots may yield partial discovery. Only repositories returned by a fresh scan can be launched.

## Open or reuse a session

```text
mars-ram launch --repo /absolute/projects/example --program pi --json
```

`--program` must be `gentle-shell`, `pi`, or `opencode`. The program must be on the CLI's PATH or at the executable path `mars-ram install` recorded (see Programs over SSH); no installation is attempted. Run `mars-ram install` in a terminal on the computer: it is the recommended way to record the paths, though the installer does not itself enforce that it runs locally. `--repo` must match a canonical path returned by discovery, not a relative path, traversal (`..`), symlink alias, arbitrary directory, or repo outside the configured scan.

Launch inspects Herdr panes and foreground process metadata. A matching repo and program is focused and reused; otherwise a new workspace is created with label `example · pi`, the fixed program command is submitted in its first pane, and its tab is focused. Focus is shared with the computer. Agent detection is live metadata, not a persisted shortcut label. Herdr's `pane run` acknowledges command submission, **not readiness or successful program startup**.

## JSON contract (version 1)

JSON is the default, as for the existing Herdr/project commands; `--json` explicitly selects the same format. Exactly one JSON line is written. Exit 0 means success; exit 1 means error.

```json
{"version":1,"ok":true,"roots":["/home/you/Work"],"repos":[{"path":"/home/you/Work/example","name":"example","root":"/home/you/Work"}],"truncated":false}
```

```json
{"version":1,"ok":true,"reused":false,"workspace":"w2","tab":"w2:t1"}
```

The reuse response has the same shape with `reused: true`. Root edits return the updated scan shape.

```json
{"version":1,"ok":false,"code":"REPO_NOT_ALLOWED","message":"The repository is not in the configured repository scan."}
```

Codes: `BAD_ARGUMENT`, `PROGRAM_NOT_ALLOWED`, `PROGRAM_NOT_FOUND`, `REPO_NOT_ALLOWED`, `HERDR_UNAVAILABLE`, `CONFIG_FAILED`, `LOCAL_ONLY`. Errors never include child output, process argv or config contents.

### Herdr list pane metadata

`mars-ram herdr list` retains its version **1** envelope and all existing workspace/tab fields. Each tab may additionally include `panes: [{ "id": "w2G:p2", "focused": true }]`, taken from the pane list already fetched (no extra subprocess). This optional additive metadata does not change the envelope version; older consumers ignore it and newer consumers accept its absence from older CLIs.

Pane IDs must match the existing scoped pane grammar and the containing workspace; only panes belonging to that tab are emitted, with duplicates removed. Each tab is capped at 128 panes (like tabs); exceeding the cap sets the envelope's `truncated`. Missing focus metadata yields `focused: false`, not invented focus. The app can use an unambiguous singleton in a focused tab; it does not guess among split panes without focus evidence. Pane metadata contains no process arguments, session paths, or terminal output.

### Herdr saved machines

Herdr can save SSH machines (`herdr machine list`, one tab-separated line per machine: `<id>\t<label>\t<ssh target>\t<session>\t<enabled|disabled>`). Every Herdr client on the computer, including the one the phone's terminal starts over SSH, then also shows the enabled machines' workspaces, so the phone's terminal on one computer can show another computer's work. mars-ram explains this and never changes Herdr's configuration:

- `mars-ram herdr list` adds an optional `machines: ["Beelink"]` with the enabled machine labels (an extra `herdr machine list` subprocess, same limits); it is omitted when there are none, when Herdr is older or the command fails. Lines that do not match the five-field format exactly are ignored; labels lose control characters and are capped at 64 characters, duplicates are removed, and at most 16 are reported. The envelope version is unchanged; the app accepts the field's absence (older hosts) and rejects a malformed value. The workspace switcher then shows «Este Herdr también muestra: Beelink» / "This Herdr also shows: Beelink".
- `mars-ram doctor` runs `herdr machine list` on the Herdr recorded in `host.json` (never a PATH guess) and, when enabled machines exist, prints one warning: `warning: Herdr also shows the workspaces of its saved machines: Beelink. The phone's terminal on this computer shows them too. To hide them: herdr machine disable Beelink` (Spanish: `aviso: Herdr también muestra los espacios de sus máquinas guardadas: Beelink. La terminal del teléfono en esta computadora también los muestra. Para ocultarlos: herdr machine disable Beelink`). No machines, a missing Herdr or a failing command print nothing and never fail doctor.

## Security and operational limits

- All Herdr subprocesses use argument arrays and `shell: false`, 5-second child deadlines and 1 MiB response limits. Workspace/tab/pane IDs are validated and scoped. No user-supplied path, label, option or program text becomes shell command text: `pane run` gets only one of three hard-coded literals.
- Herdr runs that literal in the user's interactive shell. PATH, shell startup files/aliases and installed programs remain trusted host configuration; the CLI's PATH check does not prove the pane has the same environment. On Windows, shell command lookup may also search the cwd. Only add trusted repositories and roots. Agents can execute repository code under the user's account; root confinement is a launch-location policy, not runtime containment.
- The repo is revalidated before creation, but a malicious local process can race filesystem changes. Simultaneous launches can create duplicates; startup detection may lag. No lock or persistent launch registry is introduced.
- A failure after workspace creation may leave that workspace behind. The command never closes an existing workspace or retries a mutation automatically. Inspect Herdr before retrying an ambiguous failure.
- There is no whole-operation deadline; filesystem calls and sequential metadata queries can take longer than one child deadline. Root config writes use exclusive private temporary files and rename, not a writer lock; simultaneous local config edits can lose updates, and a failed rename can leave a `repos-*.tmp` file.

## Run from a checkout

With the repository's supported Node version and dependencies already present:

```text
node host/cli/src/main.ts repos --json
node host/cli/src/main.ts launch --repo /absolute/repo --program pi --json
```

No generated build is needed. These are host-only additive CLI responses, not changes to the app/bridge protocol version. Windows path semantics are unit-tested; native Windows and phone verification remain separate checks.

### Programs over SSH

`mars-ram install` (always run in a local terminal) also records in `host.json` › `programs` the absolute paths of Gentle Shell, Pi and OpenCode found on its PATH, because the phone's SSH session usually gets the non-interactive PATH (for example without `~/Library/pnpm/bin`). `launch` counts a program as installed when it is on its own PATH or at the recorded path (an existing executable file); the recorded path is only a presence check and the Herdr pane still runs the fixed program name. After installing a program, run `mars-ram install` again.
