# Guided session shortcuts: host commands

The paired phone can list repositories and open **Gentle Shell, Pi or OpenCode** in Herdr. It cannot supply an arbitrary command or program arguments through these commands. This is not an SSH sandbox: the paired key already permits interactive Herdr terminals.

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
