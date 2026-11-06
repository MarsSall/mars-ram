# Host command

The command the user runs on their computer: install the Pi session bridge and private-link server, remove them, or pair a phone with a QR code and no cloud.

**First time:** `pnpm add -g mars-ram` (recommended), `npm i -g mars-ram` or `bun add -g mars-ram`, then `mars-ram install` (Linux, macOS or Windows; Node.js 24+). On Linux and macOS the one-line script below is an alternative. **From a clone:** with dependencies available, run `node host/cli/src/main.ts install`. **Afterwards, just `mars-ram`**: `mars-ram install` updates, `mars-ram doctor` diagnoses, `mars-ram pair` pairs a phone, and `mars-ram uninstall` removes the installation. The installed copy works without the clone.

## Install from npm

```bash
pnpm add -g mars-ram   # recommended; or npm i -g mars-ram, or bun add -g mars-ram
mars-ram install
mars-ram pair
```

The package has no install scripts (pnpm blocks them) and no dependencies; see [npm package](#npm-package). If pnpm says the global bin directory is not set, run `pnpm setup` once and open a new terminal. On Windows, use pnpm or npm.

To update: `pnpm add -g mars-ram` (or the same npm or Bun command), then `mars-ram install`. If you installed earlier with the curl script or from a clone and `mars-ram install` still runs the old version, run `mars-ram uninstall` first, then `mars-ram install`. To remove: `mars-ram uninstall`, then `pnpm remove -g mars-ram` (or `npm uninstall -g mars-ram`, `bun remove -g mars-ram`).

To read the package before installing it (Linux, macOS and Windows; Windows 10+ ships `tar`), download it; `npm pack` prints the exact file name, for example `mars-ram-0.1.2.tgz`:

```bash
npm pack mars-ram
```

Extract that exact file (with the name it printed, no wildcard):

```bash
tar -xzf mars-ram-0.1.2.tgz
```

Open `package/bin/mars-ram.mjs` (the launcher) and `package/README.md` with any editor, Notepad on Windows. The source of the launcher is `host/cli/npm/mars-ram.mjs` in the public repository https://github.com/MarsSall/mars-ram, and `package/archive/` holds the same archive as the GitHub release.

## One-line install (Linux, macOS)

```bash
curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh
```

To read it before running it:

```bash
curl -fsSL https://marssall.github.io/mars-ram/install.sh -o install.sh
less install.sh
sh install.sh
```

`install.sh` is POSIX sh, per-user, no sudo. Each script names one version and the SHA-256 of that version's archive; that embedded value is its only trust anchor (it never trusts a downloaded `SHA256SUMS`).

1. Checks Node.js 24+, `tar`, `curl` or `wget`, and `sha256sum` or `shasum`; if any is missing it says which and stops before downloading. Warns and continues when `pi`, `tailscale` or an SSH server (`sshd`; on macOS, a Remote Login hint) is not found; `mars-ram doctor` checks everything after install.
2. Downloads `https://github.com/MarsSall/mars-ram/releases/download/v<version>/mars-ram-<version>.tar.gz` into a temporary folder.
3. Verifies its SHA-256. On a mismatch it prints the expected and actual values, deletes the download and installs nothing (exit 1).
4. Unpacks it and runs `mars-ram install` with questions read from `/dev/tty`, so they work through the pipe. Without a terminal it explains how to download the script and run it. Its exit code is passed through; on success it prints the next step, `mars-ram pair`.
5. Removes the temporary folder on every exit.

`MARS_RAM_DOWNLOAD_URL` replaces the archive URL (a mirror or a local `file://` copy); the embedded checksum is still enforced, so it cannot install different bytes. Messages are in Spanish when `LC_ALL`, `LC_MESSAGES` or `LANG` starts with `es`, otherwise English. The script's whole body is one function called on its last line, so a cut-off download runs nothing.

## install.ps1 (not advertised)

The release builder still renders `install.ps1`, but the guides no longer show it: on Windows, use pnpm or npm.

`install.ps1` runs in Windows PowerShell 5.1 and PowerShell 7, per-user, no administrator rights. Like `install.sh`, it names one version and that archive's SHA-256, its only trust anchor.

1. Refuses an elevated session before anything else and asks for a normal PowerShell window (the same rule as `mars-ram install`).
2. Checks Node.js 24+ and `tar.exe` (Windows 10 1803 or newer); if either is missing it says which and stops before downloading. Warns and continues when `pi` or `tailscale` is not found, or the OpenSSH Server service `sshd` is not installed or not running; `mars-ram doctor` checks everything after install.
3. Downloads the same archive with `Invoke-WebRequest` (TLS 1.2 enabled for 5.1) into a new folder under `%TEMP%`, removed on every exit.
4. Verifies it with `Get-FileHash`. On a mismatch it prints the expected and actual values, deletes the download and installs nothing.
5. Unpacks it with `tar.exe` and runs `mars-ram install` in the same console, so its questions work through `irm | iex`. On success it prints the next step: open a **new** terminal (the user `Path` changed) and run `mars-ram pair`.

It never closes your console: the body is one function called on the last line, and a failure prints why, returns and sets `$LASTEXITCODE` (1, or the exit code of `mars-ram install`), so `powershell -File install.ps1` itself exits 0 even on a refusal. `MARS_RAM_DOWNLOAD_URL` replaces the archive URL (a mirror, a `file://` URL or a local path); the embedded checksum is still enforced. Messages are in Spanish when the regional format (`Get-Culture`) is Spanish, otherwise English. The file is plain ASCII so 5.1 reads it the same from disk or from `irm`; Spanish accents are written as `{a}`, `{e}`… and expanded at run time.

## pair

```bash
mars-ram pair [--ssh-port <port>]
```

1. Reads the computer's Tailscale address and the SSH server's Ed25519 identity.
2. Shows a QR (and the same link as text) with the address, SSH user and port, identity, a one-time code, and the expiry.
3. Listens **only on the Tailscale address**, for **5 minutes**, for **one** phone. Five invalid requests of any kind close it.
4. When a phone answers with the code, asks at the computer:
   `Authorize the phone "<name>" (<key fingerprint>)? [y/N]` — only an explicit yes (`s`, `si`, `y`, `yes`) authorizes.
5. Adds the phone's key with `restrict,port-forwarding,pty` (tunnels for the bridge and a terminal; no agent or X11 forwarding).

Ctrl+C at any moment, including during the question, cancels and authorizes nothing. A yes typed after a cancel or the expiry authorizes nothing, and neither does a yes after the phone stopped waiting.

### Where the key goes

| System | File |
|--------|------|
| Linux, macOS | `~/.ssh/authorized_keys` (created `0600` in a `0700` directory if missing) |
| Windows, administrator | `C:\\ProgramData\\ssh\\administrators_authorized_keys` — the terminal must run as administrator; the command refuses otherwise |
| Windows, other users | `%USERPROFILE%\\.ssh\\authorized_keys` |

An existing file is backed up to `<file>.bak-before-pairing` and rewritten through a private temporary file in the same directory, preserving its bytes, owner and permissions (Windows: ACL and owner). The new line is appended to that content, not written in place; a key already present (with any options) is not added again. A new file is written, restricted, and then moved into place, so a failure before rename never leaves a key behind. Pairing uses the same writer lock and snapshot checks as rotation.

Messages follow the system language: Spanish or English.

## key add / remove (automatic phone rotation)

These non-interactive commands are for the phone's automatic SSH key rotation when changing its unlock setting. They use **the same target file as pairing** (table above), never a newly created trust file. The phone runs the absolute paths recorded in `host.json`, without depending on SSH's PATH:

```text
"<node>" "<cli>" key add --key "<type> <base64>" --like "<type> <base64>"
"<node>" "<cli>" key remove --key "<type> <base64>" --keep "<type> <base64>"
```

The `mars-ram key …` launcher accepts the same arguments. Flag order is interchangeable; extra, repeated or missing flags are rejected. Arguments must contain exactly one public key, with one ASCII space, no options, comment, tabs or newlines. Only `ssh-ed25519` and `ecdsa-sha2-nistp256` with complete matching SSH blobs are accepted.

- **Add:** requires a trusted plain-key login line for `--like` even if the new key is already there. Copies that trusted line's options verbatim and adds comment `mars-ram:rotated:YYYY-MM-DD` (UTC). A trusted line with the new key material is a no-op regardless of comment. If the new key material exists only on untrusted lines, refuses rather than appending a duplicate or reporting success. stdout is exactly one JSON line: `{"added":true}` or `{"added":false}`.
- **Remove:** requires a trusted plain-key login line for `--keep`, different from `--key`. Removes **every** exact matching key line; keeps all other bytes, including comments, blank lines, order and CRLF. stdout is exactly one JSON line: `{"removed":N}` (zero is a successful no-op).
- **Never lock out:** the phone must first prove a fresh connection with the new key and pinned host identity before removing the old key. The CLI verifies only that `--keep` has a trusted plain-key login line, not that the phone possesses its private key or completed that proof.
- **File safety:** before each actual change, overwrites only `<file>.bak-before-key-change` with the original file. No-op calls leave the backup alone. Writes an exclusive private temp in the same directory, preserves POSIX owner/mode or copies Windows ACL/owner with shell-free PowerShell, then renames atomically. Administrators-file writes require an elevated process and restrict the replacement to SYSTEM and Administrators with inheritance disabled. Failures before rename leave the original unchanged and clean the temp. Real Windows ACL behavior needs native-host verification.
- **Existing-file parsing:** only ASCII space and tab separate fields; blank lines and `#` comments are ignored. Options are scanned with OpenSSH's double-quote/escaped-double-quote rules. Only recognized SSH key types with decodable, matching wire-format blobs count as keys. Unparseable lines never satisfy `--like`/`--keep` and are never removed; they remain byte-for-byte intact. Parsing key material does not imply trust: removal matches all parseable lines with the old material, trusted or not. Unicode whitespace and embedded vertical tab, form feed or carriage return are not field separators (a CRLF line ending is supported).
- **Trusted plain-key login lines (rotation only):** a plain line without options is trusted. With options, names are case-insensitive, each may appear at most once, and only these flags are trusted: `restrict`, `port-forwarding`, `pty`, `agent-forwarding`, `x11-forwarding`, `user-rc`, `no-port-forwarding`, `no-pty`, `no-agent-forwarding`, `no-x11-forwarding`, `no-user-rc`, `no-touch-required`, `verify-required`. Mars-RAM's `restrict,port-forwarding,pty` lines qualify. Every other option makes the line untrusted, including `command`, `cert-authority`, `principals`, `tunnel`, `expiry-time`, `permitopen`, `permitlisten`, `environment`, unknown options and **all `from=` clauses**. The host cannot evaluate the phone's client address for `from=`. This conservative allow-list avoids reproducing all of OpenSSH's option validation or mistaking a CA-only, invalid, or otherwise unsupported line for a usable replacement key. It does not guarantee successful login: the phone still needs the fresh-connection proof above. Pairing's material-based deduplication is unchanged.
- **Concurrency:** pairing, add and remove share `<file>.lock`, with snapshot checks for external edits. Live owners (PID + process start time) never expire; callers wait up to five seconds. Dead-owner removal is serialized under the atomically published `<file>.lock.recovery`, then rechecks the main owner's identity and liveness before removal. Recovery-lock contention waits up to two seconds. Release and recovery first atomically rename the published lock to a unique sibling `.trash` directory, then delete the trash: a crash never leaves an empty published lock. A dead recovery holder is never stolen. Main/recovery locks without readable owner metadata are also never stolen; errors name the exact path to delete manually. Process identity uses Linux `/proc` start time, Windows PowerShell process creation ticks (without a shell), or macOS `ps` start time. If identity cannot be verified, the lock is kept and both the busy error and `doctor` identify the PID, `createdAt`, and exact path to delete **only if that process is not a Mars-RAM key change**. `doctor` reports stale main/recovery locks and leftover `.trash` directories read-only with exact repair paths.

Exit **0** means success (including no-op), **2** means invalid command/flag structure (usage on stderr), and **1** means invalid public-key data, missing trust/keep key, equal removal keys, missing/unreadable/unsafe file, exhausted concurrency retries, elevation refusal, or backup/write/permission/rename failure. Errors go to stderr, never file contents or argument key material; failures print no JSON success line. There are no prompts or new access grants beyond the trusted line's existing options.

## herdr list / focus (phone session switcher)

```text
mars-ram herdr list
mars-ram herdr focus <workspaceId> [<tabId>]
```

The phone runs these through the recorded Node/CLI paths, like key rotation. `list` includes every Herdr workspace and tab, including shells and other agents. `focus` changes **shared Herdr focus**, so the PC follows the phone. These verbs cannot create/close workspaces, send terminal input, run a supplied command, or read session files.

stdout is exactly one JSON line. List returns `{ "version": 1, "workspaces": [...] }`; each workspace has `id`, `label`, `focused`, `status`, `branch` (string or null), and `tabs`. Tabs have `id`, `label`, `focused`, `status`, and `kind` (`pi`, `gentle-shell`, `shell`, or `agent`). Status is `working`, `blocked`, `done`, `idle`, or `unknown`. Gentle Shell is recognized only for Pi session paths containing the `.gentle-shell` directory; no session file is opened. Branch comes from the active tab's first pane cwd; detached HEAD uses a short SHA, and git failures return null.

Focus success is `{ "version": 1, "ok": true }`. All errors, including invalid verb/argument counts, return `{ "version": 1, "ok": false, "code": "...", "message": "..." }`. Codes: `BAD_ID` (invalid usage or mismatched workspace/tab), `NOT_FOUND` (target absent), `HERDR_NOT_FOUND` (executable missing), `HERDR_FAILED` (process/timeout/output/JSON failure). Exit **0** on success, **1** on error. Errors never echo process output, argv, cwd or session paths.

Herdr is resolved from the validated `herdr` field in `~/.mars-ram/host.json`, falling back to `herdr` on PATH (`herdr.exe` on Windows). Every process uses shell-free argv, a 1 MiB buffer, and a 3-second Herdr / 2-second git timeout. Workspace/tab ids must match Herdr's `w…` / `w…:t…` alphanumeric form, and targets must exist before focus. Listings drop malformed/duplicate entries, cap workspaces and tabs at 128 each and labels at 256 characters, and refuse final JSON over 1 MiB. At most four workspace lookups run concurrently. Only bounded, sanitized labels and metadata are returned, never raw pane data.

**Doctor note:** the existing Herdr check validates the recorded executable read-only, and the CLI freshness check warns when the installed copy needs updating. Doctor does not run list/focus or test Herdr connectivity. If the switcher reports `HERDR_NOT_FOUND`, inspect those findings; `HERDR_FAILED` can also mean Herdr is not running. Install/update is an explicit user action, never performed by these commands.

## repos / launch (guided session shortcuts)

```text
mars-ram repos [--json]
mars-ram repos --add-root <absolute directory>
mars-ram repos --remove-root <absolute directory>
mars-ram launch --repo <absolute repository path> --program <gentle-shell|pi|opencode> [--json]
```

`repos` scans `repoRoots` in `~/.mars-ram/host.json`, defaulting to `~/Work` when the field is absent and that directory exists (`%USERPROFILE%\\Work` on Windows). Root edits are local-interactive only, not SSH operations. A malformed `host.json` is an error (no fallback); `"repoRoots": []` disables discovery. A root that is a symlink is resolved to its target. Discovery stops at repositories, skips directory symlinks below a root, hidden folders and `node_modules`, goes at most three levels below each root and returns at most 500 repos in deterministic order.

`launch` accepts only a current canonical scan result and one of the three installed programs (on PATH or at the path `mars-ram install` recorded, since SSH sessions usually lack the interactive PATH; run `mars-ram install` again after installing a program). It reuses a matching Herdr pane's repo/program or creates a workspace labelled `<repo name> · <program>`, submits the fixed program command and focuses its tab. No arbitrary command or program arguments are accepted. Success returns `{version:1, ok:true, reused, workspace, tab}`; repos returns `{version:1, ok:true, roots, repos:[{path,name,root}], truncated}`. Errors use `{version:1, ok:false, code, message}`, exit 1. JSON is the default even without `--json`.

See [the command contract and security limits](../../docs/host-cli.md). In particular, Herdr submits the fixed command to the host's shell: trusted shell configuration and repository code are not sandboxed, and submission is not program readiness.

## install

First time, from a complete repository checkout with dependencies already available, run:

```bash
node host/cli/src/main.ts install
```

For subsequent installs/updates, run `mars-ram install` (run from an updated clone with `node host/cli/src/main.ts install` to install newer checkout code).

Pi must be on `PATH`. On Windows, use a **non-elevated** terminal; installation and removal refuse elevated processes. The launcher resolves supported npm/pnpm `pi.cmd` shims to their Node entry point and runs it directly, without a shell. Unsupported shim layouts produce an error before any changes.

1. Lists existing `~/.pi/agent` and `~/.gentle-shell/agent` directories separately. It does not create missing Pi environments.
2. Enter numbers to **exclude**, separated by spaces or commas, or press Enter to select all. Review the remaining paths and explicitly confirm (`s`, `si`, `sí`, `y`, or `yes`). Enter or Ctrl+C cancels without changes.
3. Copies the bridge's `src/` and `package.json` into `~/.mars-ram/pi-bridge/`, with the protocol package under `node_modules/@workspace/protocol/` and the resolved typebox package under `node_modules/typebox/`. Source/dependency symlinks are followed while copying. The fixed sibling `pi-bridge.staging` is fully built before replacement, and the old copy is moved to `pi-bridge.previous` until the replacement succeeds. If interrupted between those moves, the next confirmed install or uninstall restores the previous copy when the main copy is missing and discards unfinished staging.
   Also copies the dependency-free link server (`src/` and `package.json`, Node built-ins only; no protocol or npm dependencies) into `~/.mars-ram/link-server/`. It uses `link-server.staging` and `link-server.previous` with the same interrupted-swap recovery. A SHA-256 fingerprint of the copied source/package bytes is stored inside the swapped copy as `fingerprint.sha256`. Updates replace code only, never `~/.mars-ram/links`. Installation does **not** launch a server, create a service or register a logon task.
4. Runs `pi install <copy>` with `PI_CODING_AGENT_DIR` set separately for each selected environment. An existing package entry resolving to that copy is not registered twice. If this command did not previously record ownership of that home, it leaves that registration unchanged, does not adopt it, and prints that it will not remove it on uninstall.
5. Records the copy path, owned homes, version and date in `~/.mars-ram/install.json`. Homes needing registration are saved as `pending` **before the first `pi install`**, then moved to completed `homes` after each successful call. This lets uninstall recover even if Pi wrote settings just before an interruption. Older records without `pending` remain supported. Currently the bridge has no package version, so `version` is a `source-sha256:` fingerprint of the copied files.

6. Finds Herdr directly on the interactive terminal's `PATH`, without running a shell or Herdr, and atomically merges `~/.mars-ram/host.json` (private temporary file `host.tmp`, then rename), retaining unrelated fields:

   ```json
   {
     "herdr": "<absolute Herdr executable path, omitted if unavailable>",
     "node": "<absolute installer process.execPath>",
     "cli": "<absolute home>/.mars-ram/cli/src/main.ts",
     "linkServer": "<absolute home>/.mars-ram/link-server/src/main.ts",
     "linkPort": 47811
   }
   ```

   Node must be an absolute existing executable file (Windows: existing file). Windows Herdr lookup also checks `herdr.exe` and the supported `.exe` PATHEXT entry; command/batch shims are not executable Herdr paths. If Herdr is absent, clears its stale field, still installs both copies, and explains that the terminal will not open until Herdr is installed and install is run again. The phone's Herdr reader accepts the additional fields. The phone runs the recorded Node and main paths over SSH without relying on non-interactive PATH; Node itself is **not** copied, so reinstall if that executable moves. Native Windows paths use backslashes, JSON-escaped as usual.

7. Copies this CLI's `src/`, `package.json`, protocol, typebox and uqr into `~/.mars-ram/cli`, dereferencing dependency symlinks. It uses `cli.staging`, `cli.previous` and a swapped `fingerprint.sha256`, with the same interrupted-swap recovery. Node does not strip TypeScript under `node_modules`: the bundled protocol retains its TypeScript and adds JavaScript emitted with Node's built-in type stripper, with exports pointing to JavaScript. Fingerprints include those emitted bytes. Original protocol source/package bytes are also retained under `cli/protocol` for bridge updates and diagnostics without a checkout. The CLI path and a launcher using the stable absolute Node executable are recorded as owned in `install.json` before launcher creation (except from the npm package, below):
   - Linux/macOS: executable `~/.local/bin/mars-ram` (new bin directory mode `0755`), a `#!/bin/sh` script with an ownership marker and `exec '<node>' '<home>/.mars-ram/cli/src/main.ts' "$@"`. A pre-existing launcher without the exact marker is refused, never overwritten. If the directory is absent from PATH, install prints `fish_add_path ~/.local/bin` for fish, or `export PATH="$HOME/.local/bin:$PATH"` for bash/zsh. Shell configuration is never edited.
   - Windows: `%USERPROFILE%\\.mars-ram\\bin\\mars-ram.cmd`, with an ownership marker and `@"<node.exe>" "<main.ts>" %*`; usable in cmd, PowerShell and nushell. The raw HKCU Environment `Path` is read without expansion; a missing directory is appended while preserving `REG_SZ`/`REG_EXPAND_SZ` and all existing entries. The intended addition is recorded as pending before the registry write and becomes owned only after the write is verified; a pending record never lets uninstall remove an entry. **Open a new terminal** afterwards (no environment broadcast is sent). No machine PATH or shell profile is changed.

**From the npm package**, the package launcher sets `MARS_RAM_PACKAGE_BIN` to its own absolute path. When it names a regular file whose package (two folders up, `package.json` read bounded) is `mars-ram`, install writes **no launcher of its own**: the package's bin is the command, because an installer launcher earlier on PATH would keep running the old copy's `install` after an update. Install records `packageBin` and the CLI path in `install.json` first, then removes a launcher left by an earlier install only if it carries the ownership marker (and is not behind a linked folder), and on Windows removes the user Path entry it recorded as added, exactly as uninstall does. A file at the launcher path without the marker is kept and reported (`Kept <path>: mars-ram install did not create it…`); it is not refused in this mode, since nothing is written there. Without the variable (the curl script, a clone) install is unchanged.

Launcher updates are written to an exclusive private temporary file in the launcher's directory, given executable mode `0755` on POSIX, then renamed into place. An interrupted write leaves the previous launcher intact rather than truncated; an unmarked foreign launcher is still refused.

**Windows Path concurrency:** the registry has no atomic compare-and-set. The installer opens one writable key, reads and compares the raw value and type through that handle, writes, then immediately reads back the value and type through the same handle. A detected conflict reports `User Path changed while installing; run install again` and does not confirm ownership of the addition. This only narrows the race: another process can still write between comparison and write (its update could be overwritten), or after verification. Avoid concurrent Path edits; on conflict inspect the user Path and retry. A failed verification does not roll back, since that could overwrite another writer's changes. Empty Path components and unexpanded variables are retained exactly; doctor ignores empty components when looking up the launcher.

Run the same command again to update the copy or select additional homes. Previously recorded homes are retained, even when excluded from the new registration selection: they already reference the shared copy and therefore receive its update too. Open Pi sessions load the bridge on their next start or `/reload`. The installed copy does not depend on the development checkout.

Before any installer changes, both install and uninstall refuse symlinks or Windows junctions at `~/.mars-ram`, `pi-bridge`, `link-server`, `cli`, `bin`, `install.json`, `host.json`, `host.tmp`, and installer staging/backup/temporary paths (including old random-name leftovers). The resolved product root must be `<real home>/.mars-ram`. If refused, check those paths and resolve the links yourself; the command does not follow them to delete their targets.

Messages and prompts follow the system language (Spanish or English). No administrator rights, SSH changes, pairing changes, or other agent integrations are involved.

## uninstall

```bash
mars-ram uninstall
```

Removes the CLI copy/staging/backup and the recorded launcher only if its ownership marker remains. On Windows, removes only the last exact occurrence of the entry confirmed as added by install from the raw user Path (install always appends), preserving any earlier duplicates, empty components, other entries and the value type; an already-present entry is never adopted or removed. Open a new terminal after removal. The bin directory itself is retained, as it may contain other user files. Run from the npm package, uninstall removes what install wrote and leaves the package itself: it prints that `pnpm remove -g mars-ram` (or `npm uninstall -g mars-ram`) removes it.

Shows only the completed and pending homes recorded in `~/.mars-ram/install.json` and asks for confirmation. Checks each home's settings first, runs `pi remove <copy>` only when that registration is still present, and drops successfully handled homes from the record. It never removes unrecorded registrations. After all recorded homes are handled, it deletes `~/.mars-ram/pi-bridge/`, `~/.mars-ram/link-server/`, `~/.mars-ram/install.json`, and the fixed installer staging/backup/temporary leftovers. It removes `herdr`, `node`, `cli`, `linkServer` and `linkPort` from `host.json`, preserving unrelated fields; an empty host record is deleted. With no state file, uninstall still recovers and cleans those installer-owned paths without running Pi. Other Pi homes, the bridges registry, uploads, paired phones, and everything under `~/.ssh/` are untouched. **`~/.mars-ram/links` is retained as user data:** T2 does not specify deleting that store on uninstall.

**Runtime cleanup:** before removing the installed link-server copy, uninstall runs that copy's `stop` with the current absolute Node executable, without a shell and with a **20-second** timeout. The command confirms the PID and its boot identity before sending SIGTERM (Linux) or ending the `mars-ram-links` task (Windows); it never kills a process by name or an unconfirmed PID. Windows also deletes that task registration; if identity cannot be confirmed it removes the registration without ending its process. An absent server is an idempotent no-op. Stop failures are reported with a nonzero uninstall result, but best-effort copy/config removal still proceeds. Retained copies in `~/.mars-ram/links` are not revoked or deleted: a failed stop or unconfirmed boot may continue serving them until expiry. Native Windows task cleanup still requires real-host verification.

If one removal fails, the command reports that home and exits nonzero. Successful removals are removed from the record; failed homes remain recorded and the shared copy is kept. Fix the reported issue and run `uninstall` again. Pi must still be available on `PATH` to uninstall. Do not manually delete the state file while any recorded home still uses the copy.

## doctor

```bash
mars-ram doctor
```

Read-only diagnostics: no prompts, writes, pruning, installation, service changes or automatic fixes. Every finding is one line beginning with `ok`, `warning`, or `problem`; each non-ok line explains what you can do. Exit status is **1 if any problem exists, otherwise 0** (warnings alone do not fail). Messages follow the system language, Spanish or English. Commands use `execFile` without a shell and have a ten-second timeout; Windows Pi uses the installer's shell-free Node-entry resolution.

| Check | What doctor reads and reports |
|-------|-------------------------------|
| CLI command/copy | Looks up `mars-ram` on PATH without running it; of what it finds, it reads only the installer's own launcher, for its ownership marker. Installed from a clone or the curl script, checks that it resolves to the marked installed launcher; any other `mars-ram` warns. When `install.json` records `packageBin` (installed from the package), doctor does not guess what the command is: it prints its path as information (`ok: mars-ram on PATH: <path>`), warns `mars-ram is not on PATH.` (open a new terminal or check the pnpm/npm install, `pnpm setup`) when there is none, and warns `mars-ram on PATH is the old launcher from mars-ram install;` (run `mars-ram install` again to retire it) only when it resolves to the installer's own launcher with the ownership marker; `~/.local/bin` is not checked. Doctor also compares the CLI/protocol/typebox/uqr copy against the invoking source (an updated clone is needed to detect newer code). Also requires `host.json`'s `cli` to name the exact existing installed entry; missing/invalid config makes the copy check warn to reinstall. On Linux also reports whether `~/.local/bin` is on PATH, with fish and bash/zsh advice. No registry writes. Shell aliases/functions are not observable through filesystem PATH lookup. |
| Herdr | Reads `~/.mars-ram/host.json` without executing Herdr. An absolute safe path to an existing executable regular file named exactly `herdr` or `herdr.exe` is ok. Missing, invalid, non-executable or moved files warn to install Herdr and run `mars-ram install` again. |
| Pi | Pi on `PATH` and `pi --version`. Missing is a problem; older than **1.2.0**, or an unrecognized version, is a warning because the bridge needs `getSettings`. |
| Bridge installed | `~/.mars-ram/install.json`, then `settings.json` in **every existing** plain Pi and Gentle Shell home, including relative and object `packages` entries resolving to the copy. Missing registration or state warns to run `mars-ram install`. |
| Copy freshness | SHA-256 comparisons of the installed bridge, protocol and typebox against current checkout/dependency bytes. A missing or changed copy warns to re-run install; doctor does not build a replacement. |
| Bridge loaded | Registry JSON in `~/.mars-ram/bridges` and PID liveness. Shows a live count; warns about zero live sessions and stale/invalid entries. Stale entries are pruned by the **next bridge start**, not doctor. Tokens are never printed. |
| Registry/token permissions | Linux: directory exactly `0700`, entries exactly `0600`; unsafe or unreadable modes are problems. Windows: read-only PowerShell `Get-Acl`, using SIDs, checks the owner and allowed grants on `~\\.mars-ram`, the registry directory and its children: only the current user, SYSTEM and Administrators. An Administrators-owned product folder warns about the non-elevated bridge failure (terminal-fallback L9). Only an **empty** folder may be manually removed and recreated by non-elevated Pi; otherwise transfer ownership without deleting paired data. |
| Link-server copy/config | Existing installed `src/main.ts`, SHA-256 comparison of `src/` and `package.json` against current checkout, and `host.json`'s existing absolute Node executable and exact installed main path plus port 47811. Missing, moved or outdated files/config warn to reinstall. Only a fingerprint-current, configured installed copy is allowed to execute the read-only `status` command. |
| Link-server activity | Runs `node <installed-main> status` only when copy freshness and configuration are valid (10-second command timeout). Status returns `{ serving, links }`, counts validated unexpired entries without initializing storage or pruning, and confirms a live PID plus its boot-identity HEAD response rather than trusting TCP reachability. That HEAD route performs no store access. Zero links/no listener is normal on-demand idle; valid links without a confirmed listener warn to connect the phone. With missing/outdated code or bad config, doctor only reads metadata to count unexpired entries and makes no serving claim. Malformed/unreadable storage produces diagnostic failure rather than a false count. No URLs/tokens are printed, and `list`/`ensure` are never called. |
| Tailscale | `tailscale ip -4`; unavailable or invalid IPv4 is a problem. Install/sign in/connect manually. |
| SSH forwarding | Linux: tries `sshd -T`; if unavailable unprivileged, reads `/etc/ssh/sshd_config` and `sshd_config.d/*.conf`. Windows: reads `C:\\ProgramData\\ssh\\sshd_config` (or `%ProgramData%`) and drop-ins. Effective `sshd -T` output is authoritative when available. Only recognized explicit forwarding values yield a result: `AllowTcpForwarding no/remote` or `DisableForwarding yes` is a problem; `AllowTcpForwarding yes/all/local` permits forwarding unless disabled. Missing/empty/unreadable configuration, absent directives, unknown forwarding values, unresolved `Include` directives and unevaluated `Match` blocks warn that forwarding could not be determined, with advice to check `sshd_config`; they never default to allowed. The Linux fallback expands the supported `sshd_config.d/*.conf` Include in place, in sorted order; other Includes warn. |
| Paired SSH keys | Reads the user's `authorized_keys` (Windows administrators: the shared administrators file). Only lines whose comment starts `mars-ram:` are checked. Unrestricted keys or `restrict,port-forwarding` allow tunnels; restricted keys without it, or explicit `no-port-forwarding`, warn. No keys is not a forwarding failure. Never edits keys or creates backups. |
| Key writer locks | Checks `authorized_keys.lock` and `.lock.recovery` owner PID + process start time. Stale holders, directories without readable owner metadata, and leftover lock `.trash` directories warn with the exact path to delete manually. Unverifiable live holders report PID, `createdAt`, and conditional repair advice (delete only if that process is not a Mars-RAM key change). Never removes locks. |
| Windows OpenSSH | `sc.exe query sshd` must show a running OpenSSH Server service; missing/stopped is a problem. |
| Windows default shell | Reads `reg.exe query HKLM\\SOFTWARE\\OpenSSH /v DefaultShell`. `cmd.exe`, or no value (OpenSSH defaults to cmd), is ok: the phone terminal needs cmd. `powershell.exe` or `pwsh.exe` warns that the phone terminal will not open; any other shell warns that it is untested. Both warnings explain how to restore cmd with the command below. |

**Terminal-first compatibility:** Windows terminal launch currently supports **cmd** as the SSH default shell. A quoted Herdr path in PowerShell requires the `&` call operator and is not supported yet; other default shells are untested. No product feature requires PowerShell as the SSH default shell. Windows permission checks invoke PowerShell directly, independently of that setting.

If doctor reports a Windows default-shell warning, **you** can restore OpenSSH's default (cmd) by removing the configured value in administrator PowerShell:

```powershell
Remove-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell
```

Doctor never runs that command. SSH configuration/service fixes likewise require the user's administrator action. An unreadable check is a problem with read-access advice, except uncertain SSH forwarding, which is a warning; later checks still run.

## Develop

```bash
pnpm vitest run --project unit host/cli   # includes the Ctrl+C test in a pseudo-terminal (Linux)
pnpm --filter @workspace/host-cli typecheck
```

## Release archive

```bash
pnpm release:host <MAJOR.MINOR.PATCH> <outDir>   # node host/cli/scripts/build-release.ts
```

Writes `<outDir>/mars-ram-<version>.tar.gz`, `<outDir>/SHA256SUMS` (`sha256sum` format; check with `sha256sum -c SHA256SUMS`), `<outDir>/install.sh` and `<outDir>/install.ps1`, rendered from `scripts/install.sh` and `scripts/install.ps1` with the version and the archive's SHA-256, and the npm package `<outDir>/mars-ram-<version>.tgz` (below). It needs GNU tar and refuses an invalid version or an existing archive, `SHA256SUMS`, `install.sh`, `install.ps1` or `.tgz`; if a write fails, it removes the files it already wrote. The same version from the same sources gives the same bytes: sorted names, time 0, owner 0, normalized modes, gzip without timestamp.

```text
mars-ram-<version>/
  VERSION
  cli/          the same copy `mars-ram install` makes (src, protocol, typebox, uqr)
  link-server/  src, package.json
  pi-bridge/    src, package.json
```

It needs only Node 24+ on the computer: extract it anywhere and run `node mars-ram-<version>/cli/src/main.ts install`. The builder only writes local files; publishing a release is a separate decision of the owner.

### npm package

`mars-ram-<version>.tgz` is the `mars-ram` npm package (`package/` root, like `npm pack`), reproducible like the archive. Node refuses to strip TypeScript types under `node_modules`, so the package carries the release archive and a JavaScript launcher instead of the sources:

```text
package/
  package.json              name mars-ram, bin mars-ram, engines node >=24, license UNLICENSED; no scripts, no dependencies
  README.md                 rendered from npm/README.md
  bin/mars-ram.mjs          rendered from npm/mars-ram.mjs (Node built-ins only)
  archive/mars-ram-<version>.tar.gz   the release archive, byte for byte
```

The launcher has the version, the archive's SHA-256 and the CLI copy's `fingerprint.sha256` written into it at build time.

- For `install`, `uninstall`, and any command when `~/.mars-ram/cli/fingerprint.sha256` is missing or different, it checks the archive against the SHA-256 and refuses on a mismatch (exit 1, expected and actual values, nothing run). Then it unpacks the checked bytes into a new private folder under the system temporary folder (`mkdtemp`, 0700), using `tar` (on Windows `%SystemRoot%\System32\tar.exe`). It runs `node --disable-warning=ExperimentalWarning <tmp>/mars-ram-<version>/cli/src/main.ts …` and removes the folder when the CLI ends. Its signal handlers are installed before the folder is created, so SIGTERM or SIGHUP during unpacking waits for it, reaches the CLI as soon as it starts, and the folder is still removed. Only a killed launcher (SIGKILL) leaves it behind.
- When the installed copy has the same fingerprint, it runs `~/.mars-ram/cli/src/main.ts` directly, without unpacking.

The launcher passes the CLI's exit code or signal through. Ctrl+C reaches the CLI directly, and SIGTERM or SIGHUP sent to the launcher is passed on to the CLI. Its own messages follow the CLI's locale rule.

It passes `MARS_RAM_PACKAGE_BIN=<its own path>` to the CLI, so `mars-ram install` from the package writes no launcher of its own and removes an owned one left by the curl script or a clone (see install). The only `mars-ram` command is then the package manager's (`$PNPM_HOME/bin`, `<npm prefix>/bin`), and `mars-ram doctor` reports its path as information: "mars-ram on PATH: <path>" (see doctor).

What the SHA-256 protects: the value written into the launcher detects a damaged or truncated archive. It does not stop someone who can write the package folder (they can change the launcher and its value together), your home folder (`~/.mars-ram`, which the launcher runs directly when its fingerprint matches) or the parent of the temporary folder; anyone with that access already runs code as you.

## Layout

| Path | Layer |
|------|-------|
| `src/core/` | Pairing session, install/uninstall and read-only doctor policy, with ports for platform operations |
| `src/adapters/` | Tailscale, identity, authorized keys, HTTP endpoint, terminal, filesystem copy and shell-free Pi execution |
| `src/arguments.ts`, `src/main.ts`, `src/install-command.ts`, `src/doctor-command.ts` | Strict argument parsing, interactive selection, diagnostic output and wiring |
| `scripts/build-release.ts`, `scripts/install.sh`, `scripts/install.ps1` | Release archive builder and the one-line installer templates it renders (not part of the installed copy) |
| `npm/mars-ram.mjs`, `npm/README.md` | npm package launcher and README templates rendered by the builder |
