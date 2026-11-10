# SSH native module

Kotlin native module that gives the app SSH access to the user's computer: a key that never leaves the phone, host identity pinning, commands, SFTP reads and uploads, and tunnels to the session bridge. Built on [sshj](https://github.com/hierynomus/sshj) with the Expo Modules API; the app reaches it only through the `HostConnection` and `TerminalChannel` ports (`src/core/ports.ts`).

## API

| Function | Does |
|----------|------|
| `ensureKey(alias, requireUnlock, comment)` | Creates an ECDSA P-256 key inside the Android Keystore if missing and returns its `authorized_keys` line and fingerprint |
| `deleteKey(alias)` | Deletes the key |
| `unlock(title)` | Asks for a fingerprint, face, PIN, or pattern; a key created with `requireUnlock` can sign for 300 s afterwards. A key's `requireUnlock` cannot change after creation: the app creates a new alias and rotates (see `core/key-security.ts`) |
| `connect(options)` | Connects, checks the host identity against `expectedFingerprint`, and authenticates; returns a connection ID |
| `exec(connectionId, command)` | Runs a short command on an open connection |
| `homeDirectory(connectionId)` | Returns `{ ok: true, path }` from SFTP realpath of `.`; converts Windows OpenSSH `/C:/Users/x` to `C:\Users\x`, without a shell or a guessed username |
| `listDir`, `readFile` | SFTP, with paths relative to the user's home on Linux and Windows; listings include `modifiedAt` in milliseconds since 1970 |
| `uploadFile(connectionId, sourceUri, remoteDir, remoteName, maxBytes)` | Streams a `content://` picker URI or `file://` cache URI to a home-relative directory; returns `{ ok: true, size }` |
| `removeFile(connectionId, path)` | Removes one regular file at a home-relative path; returns `{ ok: true }` |
| `forwardLocal(connectionId, remotePort)` | Tunnel from a free port on the phone's `127.0.0.1` to `remotePort` on the host's own `127.0.0.1` |
| `openTerminal(connectionId, command, cols, rows, term = "xterm-256color")` | Allocates a PTY on an open connection and sends an exec request; returns `{ ok: true, terminalId }` |
| `writeTerminal(terminalId, base64Data)` | Writes arbitrary bytes (keys, pasted text, mouse reports), at most 64 KiB per call |
| `resizeTerminal(terminalId, cols, rows)` | Sends PTY window-change; returns `{ ok: true }` |
| `closeTerminal(terminalId)` | Idempotently closes the channel, not the persistent Herdr session |
| `closeForward`, `disconnect`, `isConnected` | Lifecycle; disconnecting closes the connection's tunnels and terminals |
| `startModelDownload(url, fileName, title, description)`, `modelDownloadStatus()`, `cancelModelDownload()` | The voice model's one DownloadManager download (https only, into the app's external files folder, no permission): a start returns the kept download instead of a second one; status is `{ state, written, total, uri }`; cancel removes it with its file and notification. Never reject (see `docs/architecture.md`, Voice model download) |

Expected failures are returned as `{ ok: false, code, message }`, never thrown. Codes: `KEY_MISSING`, `KEY_INVALIDATED`, `UNLOCK_REQUIRED`, `HOST_KEY_UNKNOWN`, `HOST_KEY_CHANGED` (both with `fingerprint`), `HOST_NOT_FOUND`, `UNREACHABLE`, `AUTH_FAILED`, `TIMEOUT`, `NOT_CONNECTED`, `NOT_FOUND`, `PERMISSION_DENIED`, `TOO_LARGE`, `SOURCE_UNREADABLE` (the selected local attachment cannot be opened or read), `SSH_ERROR`.

## Rules it enforces

- **Host identity:** `expectedFingerprint: null` never connects; it reports the identity so the user can confirm it. A different identity fails with `HOST_KEY_CHANGED`.
- **Errors by stage:** a timeout while connecting is `UNREACHABLE`; while authenticating or connected it is `TIMEOUT`; `AUTH_FAILED` means the host rejected the key.
- **Bounded waits:** channel reads time out after 30 s; keep-alives every 15 s close dead links.
- **Name lookup:** a failed lookup is retried once, then `fallbackHost` is tried; the identity check applies on either path.
- **Uploads:** enforce the caller's positive byte cap (25 MB for attachments) using both declared size and a streaming counter. Create missing parents private (`0700`), without changing existing folders; create an exclusive `0600` `.part` file, then rename without overwriting an existing destination. Failures trigger best-effort `.part` cleanup. Names cannot be empty, start with `.`, contain `/`, `\\` or `:`, or end in `.part`; upload directories must stay relative to home, and existing parents must be directories, not symlinks.
- **Terminals:** only `[herdrPath]` or `[herdrPath, "--session", name]` is allowed. `herdrPath` is either bare `herdr` or an absolute POSIX `/…` or Windows `X:\…` path ending in exactly `herdr` or `herdr.exe`, containing only `[A-Za-z0-9._/\\: -]`, with no `..` component. The app reads the installer's `.mars-ram/host.json` over SFTP (4 KiB cap), validates its `herdr` path, and otherwise falls back to bare `herdr`. Session arguments require `name` matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (1–64 characters, starting with a letter or digit so it cannot be interpreted as a Herdr option); all other commands fail with `SSH_ERROR`, `Only Herdr can be opened`. Absolute POSIX/fish paths are single-quoted; Windows drive paths are double-quoted, preserving spaces without permitting shell expansion. Bare `herdr` and validated session arguments remain unquoted. Windows **cmd as the SSH default shell** is supported. A PowerShell default shell requires its `&` call operator for a quoted executable and is **not supported yet**; prefixing `&` unconditionally would break cmd. Host doctor reports cmd (or no DefaultShell value) as the supported default and warns when PowerShell is set. This sends **exec, not a shell request**: it does not open the user's default interactive shell. PTY columns and rows must each be 1–1000, on open and resize; the terminal type defaults to `xterm-256color` and permits only 1–64 ASCII letters, digits, `.`, `_`, `-`. Writes require base64 and are capped at 64 KiB decoded. Terminal input/output is **never logged**, including error messages. A connection drop, explicit close, or module destruction ends its readers and emits one exit; closing the client leaves Herdr's persistent host session available to reattach (reconnect policy lives in the app core).
- **Tunnels:** listen only on the phone's `127.0.0.1` and reach only the host's `127.0.0.1`. Closing a tunnel also cuts the connections flowing through it.

## Terminal events and port

- `onTerminalOutput { terminalId, data }`: `data` is base64, coalesced by a reader thread into at most 32 KiB per event, at most once per 16 ms. Both stdout and extended stderr are drained; PTY servers normally merge them. Idle readers sleep rather than busy-loop, and no-progress reads end the current drain.
- `onTerminalExit { terminalId, exitStatus, reason }`: status is an integer or `null`; reasons are `exited`, `closed`, `channel_closed`, `connection_closed`, or `module_destroyed`. EOF waits up to one second for the server's exit status. Local close/drop may have no status.
- `TerminalChannel` exposes `open`, `write(Uint8Array)`, `resize`, `close`, and `subscribe(terminalId, { onOutput, onExit })` returning an unsubscribe function. The adapter converts bytes without dependencies. The adapter installs event capture before native open, retaining the initial draw and fast exits until subscription. Pending output is capped at 256 KiB decoded (globally per pending open until its ID is known, then only that terminal's events); at most 1024 events are retained, including empty output and exit metadata. Oldest events are dropped on overflow, and the subscriber receives one `onExit({ exitStatus: null, reason: "overflow" })` marker before the retained tail; this reports a capture gap, not a native process exit. Native listeners detach on exit, with fast-exit replay retained only until subscription or the deadline; close and unsubscribe release the capture too. Subscribe immediately after open and unsubscribe when leaving the screen. If no subscriber attaches within 10 seconds of starting open, capture is disposed and the terminal is closed (or closed as soon as a still-pending native open returns its ID). Call close explicitly when abandoning an open rather than waiting for the deadline. `FakeTerminalChannel` records opens/writes/resizes and supports `pushOutput` / `pushExit` for core tests.

## How signing works

Android's built-in "BC" provider lacks algorithms sshj needs, so `Crypto.ensureReady` replaces it with the full Bouncy Castle for the whole app process. Bouncy Castle cannot sign with Keystore keys, so `SshConfig` wraps only the `ecdsa-sha2-nistp256` key algorithm: signing goes through the platform provider selection, which routes Keystore keys to the Keystore; verification stays with sshj. Before connecting, the module checks the key can sign, because sshj hides the Keystore's "not unlocked" error behind a generic authentication failure.

## Develop

Native changes need a new development build: `pnpm --filter @workspace/mobile android`, or `npx expo prebuild --platform android` and `./gradlew assembleDebug` with `ANDROID_HOME` set. The temporary probe screen in `App.tsx` drives every function on a real phone.
