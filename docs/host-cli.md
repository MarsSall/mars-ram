# Guided session shortcuts: host commands

The paired phone can list repositories and open **Gentle Shell, Pi or OpenCode** in Herdr. It cannot supply an arbitrary command or program arguments through these commands. This is not an SSH sandbox: the paired key already permits interactive Herdr terminals.

## Read the installed host release

`mars-ram version` prints a release such as `0.1.6`; `mars-ram version --json` prints exactly one bounded line:

```json
{"version":1,"release":"0.1.6"}
```

Both exit 0, without prompts, network or changes. Only the optional `--json` flag is accepted; other/duplicate arguments exit 2 with usage. The envelope `version: 1` is separate from both the release and the bridge protocol. A checkout with no valid release metadata prints `dev` (or `{"version":1,"release":"dev"}`), not an error.

`host/cli/scripts/build-release.ts` embeds `cli/VERSION` in the archive; `buildCliCopy` carries it through installation and subsequent reinstalls into `~/.mars-ram/cli/VERSION`. The phone invokes the absolute recorded Node and `cli/src/main.ts` paths, with the same conservative POSIX/cmd quoting as the Herdr switcher, so the result does not depend on SSH PATH or npm launcher variables. The bridge source fingerprint in `install.json` is unchanged.

The phone warns prominently below its `MINIMUM_HOST_VERSION` (`apps/mobile/src/core/host-update.ts`, now **0.1.6**: it was 0.1.4, the first release with `version --json`, became 0.1.5 because attachments need `mars-ram uploads-dir` and ZeroTier pairing needs `mars-ram pair-zt`, and became 0.1.6 because private links and Siempre atento over ZeroTier, and the project browser's refusal of hard links, first shipped in 0.1.6; bump only when newly required host functionality needs it). A CLI without `version --json` (0.1.3 or older) always counts as below the minimum. An older CLI's nonzero/usage response is treated as legacy, without breaking sessions; transport failures and malformed successful responses are unknown, not evidence of an old release. `dev` never warns. A validated newer npm release gives only a subtle optional notice. The copyable remedy is `pnpm add -g mars-ram@<target>` followed by `mars-ram install`, run in the **computer's terminal**, on Linux or Windows. A still-running session with an older compatible bridge protocol minor gets a separate `/reload` hint.

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
