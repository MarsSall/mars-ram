# Private link server

A self-contained Node ≥24 workspace package. It uses only Node built-ins and runs TypeScript directly; no build, Pi session, permanent service, or logon task is needed.

## Phone and installer contract

Run `node <absolute-main.ts> <command>` over SSH. Install records the absolute Node and main paths. Successful management commands write **one JSON line** to stdout. Errors write a fixed, safe diagnostic to stderr and exit nonzero; no command accepts a token as an argument. Treat stdout URLs as secrets: do not log them.

| Command | Output |
| --- | --- |
| `create --staged <name> [--port N]` | `{ "id": "…", "url": "http://<tailscale-dns>:<port>/l/<token>", "expiresAt": "<ISO UTC>" }` |
| `list [--port N]` | `{ "serving": true, "links": [{ "id": "…", "fileName": "…", "size": 123, "createdAt": "<ISO UTC>", "expiresAt": "<ISO UTC>", "url": "…" }] }` |
| `delete <id> [--port N]` | `{ "ok": true }`, including when the id is already gone |
| `ensure [--port N]` | `{ "serving": true }` if valid links exist and a server is confirmed running, otherwise `{ "serving": false }` |
| `status [--port N]` | `{ "serving": false, "links": 0, "invalid": 0 }`; counts of validated unexpired links and invalid/incomplete id entries, confirmed serving identity; read-only, including when storage is absent |
| `stop [--port N]` | `{ "stopped": true }` after a confirmed boot stops; `false` when no boot can be confirmed (never signals an unconfirmed PID) |
| `serve [--port N]` | Internal detached entry point; no stdout output |

The default port is **47811**. An override must be an integer from 1 through 65535; use the same configured port for every command. Unknown/duplicate options are rejected. `list` deletes expired links rather than listing them. With no links, `list` is `{ "serving": false, "links": [] }` and `ensure` never launches anything. With links, `list` requires usable Tailscale status to construct current DNS URLs; unavailable Tailscale returns an error, not an availability claim. A failed launch leaves the registered copy available for `list`, retry with `ensure`, or deletion.

### Storage and SFTP staging

All paths belong to the host user, independent of attachment uploads:

```text
~/.mars-ram/links/
  .staging/<name>           # SFTP upload here: private .part, then rename
  .tmp-<random>/           # private, unpublished registration work
  <id>/
    content                # the uploaded copy's bytes (fixed internal filename)
    link.json              # metadata below
  server.pid.json          # private PID / boot identity / endpoint record
```

The phone finishes its existing private `.part` + rename upload in `.staging`, then calls `create --staged <name>`. `list` or `ensure` can initialize storage before that first SFTP upload. Directories use 0700 and files 0600 on POSIX; Windows replaces ACLs with a single current-user SID rule, dropping inherited and explicit permissions for others. SFTP must create private files as it already does for attachments. Linked storage directories are refused.

`link.json` is exactly `{ id, token, fileName, size, contentKind, mime, createdAt, expiresAt }`. `size` is bytes; timestamps are ISO UTC strings; `contentKind` is `"image"` or `"download"`. `fileName` preserves the staged name; the stored copy is always called `content` so even an upload named `link.json` cannot collide with metadata. Registration reads a checked file handle into bounded memory, writes those exact bytes and complete `link.json` into a private `.tmp-<random>` directory inside the store, and publishes the entire directory with one `rename` to `<id>`. File contents are fsynced before publication; directory fsync is used on POSIX (not supported through Node on Windows). Existing ids are skipped; concurrent publication collisions (`EEXIST`/`ENOTEMPTY`) retry with a new random id and metadata while still private. Published id directories are never rewritten by registration. Readers never see a partially built id directory; interrupted private work is invisible to list, serving and status, even if its metadata is complete. The staging entry is removed after publication only if its device, inode, size and timestamps still match the inspected upload; a replacement is kept. This is a move by checked-copy-and-unlink, not a rename of an unchecked path. Maximum size: **25 MiB**, matching protocol `ATTACHMENT_MAX_BYTES`.

Cleanup runs during `list`, `ensure`, valid-link requests and the server's minute sweep. Invalid, unreadable or missing `link.json` entries are never served and are counted by read-only `status` as `invalid`. Before removing an invalid real id directory, cleanup re-reads and validates metadata (a now-valid registration is kept), and requires the **newest mtime or ctime of the directory and all known files to be strictly older than 24 hours**. The same newest-mtime/ctime grace applies to `.tmp-*` directories, which are never treated as published links or counted as invalid by status. Cleanup never recursively deletes: it unlinks only `content`, `link.json` and legacy `link.json.pending`, then calls `rmdir`. Unknown files or subdirectories prevent removal and leave the entry counted as invalid; only symlinks at those known filenames can be unlinked, never their targets. Symlinked id entries remain invalid and require manual attention.

The same grace period applies to the mtime of single-link regular files in `.staging`, including unfinished `.part` uploads. Immediately before unlinking, cleanup requires unchanged device, inode, size, mtime and ctime; refreshed or replaced uploads are skipped. Cleanup captures the identities of `links` and `.staging` at the start of the pass, then re-`lstat`s both before every removal, requiring the same device/inode and real-directory type. Any mismatch or inspection error aborts the entire pass, never continuing through an ancestor symlink. Id-directory identity is also checked before each removal. Unrelated store names are ignored. Cleanup is opportunistic, not a permanent background service: while the server is stopped, the next `list`/`ensure` performs it.

### Atomic publication and local trust boundary

No registration/cleanup lock or lock recovery is needed. Ordinary concurrent registrations build independent private directories and publish only complete links. Cleanup skips fresh private work and retains valid published metadata, so it can run before or after publication without removing a new link. Private work stalled beyond the 24-hour grace can be reclaimed; an interrupted operation leaves only grace-cleanable private work, never a lock that blocks future registrations. Staging additionally uses the identity/activity recheck described above because SFTP can replace uploads independently.

**Threat-model note:** these checks protect against observed replacements and ordinary concurrent upload/registration activity; they are not a sandbox against another process running as the same user. Such a process can always alter these files and metadata, and can still race the interval between the final path check and a filesystem operation. Node's portable path APIs do not provide descriptor-relative, atomic check-and-unlink containment or a portable no-replace directory rename across Linux and Windows. POSIX rename can replace an empty directory: existing ids are checked before rename, and ordinary concurrent registrations publish nonempty directories, but a hostile same-user process could insert an empty destination after that check. The store must remain private to the trusted host account; a hostile same-user process is outside this boundary. Native Windows rename-over-directory semantics and junction race behavior still require runtime verification.

Names match the protocol's UploadName character/device/`.part` rules, with an additional rejection of any `..`: 1–200 ASCII characters, letters/digits at both ends, letters/digits/dot/underscore/hyphen inside; no separators, leading dots, Windows devices, unfinished `.part` (case insensitive), or `..`. Symlinks, hard links, directories, changed handles, and oversized files are refused. Stored files are checked again through an open handle when serving.

Ids are **12 base64url characters**, generated from 9 random bytes, non-secret and used only for management. Tokens are **32 random bytes encoded base64url** (43 characters), generated on the host. Expiry is creation time plus exactly 24 hours. Tokens never appear in child argv, diagnostics or request logs; the intended JSON URL and private metadata necessarily contain them.

### Listener and browser behavior

Production obtains `Self.TailscaleIPs` and `Self.DNSName` from `tailscale status --json`, requires `BackendState: Running`, selects a Tailscale IPv4 (100.64.0.0/10), and strips the trailing DNS dot. It binds **only that IP**, never wildcard, LAN or loopback. Unavailable Tailscale or a failed bind exits nonzero. There is no bind flag or environment override; tests inject loopback into the HTTP adapter directly.

Only GET/HEAD with an exact raw `/l/<43-character-token>` target can serve a copy. Tokens are indexed by SHA-256 then compared with `timingSafeEqual`. Unknown, expired, path-like, encoded, query-bearing, or other routes return the same `404` / `Not found\n`; other methods also return 404. Invalid methods/routes are rejected before any storage access. HEAD uses registered size/type metadata without opening or reading content, and has no body. Every response includes:

- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: default-src 'none'; img-src 'self'; sandbox`
- `Cache-Control: no-store`
- `Referrer-Policy: no-referrer`

PNG, JPEG, GIF87a/GIF89a and WebP are identified by magic bytes, not extension, and get their exact image MIME and `Content-Disposition: inline`. Everything else (including HTML and SVG) uses `application/octet-stream` and `attachment; filename*=UTF-8''<sanitized-encoded-name>`. For GET, the HTTP adapter inspects at most 12 magic bytes from an open handle verified against the file's device/inode, regular-file type, single link and registered size. It streams that same handle with a fixed end offset and a **64 KiB** read high-water mark, respecting response backpressure rather than buffering entire files. HEAD trusts metadata derived during registration.

Resource limits: **4** concurrent admitted requests (including metadata reads and responses), **32** total TCP connections, **10 minutes** total response lifetime, **30 seconds** socket/write inactivity, **15 seconds** request timeout, **10 seconds** header timeout and **1 second** keep-alive. Admission overload returns **503**, `Retry-After: 1` and `Connection: close` without storage access; connections beyond the TCP cap are dropped by Node. Admitted slots are retained until both asynchronous handling and response completion, so timed-out disk operations cannot accumulate behind new admissions. Limits are host-side constants; only adapter tests inject shorter deadlines.

Valid link requests sweep expiry; a minute timer also deletes expired copies. Invalid routes, including the boot-identity probe, do not sweep. A second validity check after opening prevents serving a copy that crossed expiry while opening. Active streams have an expiry deadline plus a **1-second** clock-recheck interval (for clock changes), including while backpressured, and are destroyed when expired. Each second they also recheck that their link is still registered, so deleting a link stops its ongoing downloads within about a second even while another link keeps the server running. Closed, failed or timed-out responses destroy their stream and close its handle.

## On-demand lifecycle

`create` registers a copy then calls `ensure`. `ensure` starts only with valid links, and waits for readiness rather than assuming spawn succeeded. It verifies a live PID plus a private PID record's public random boot identity returned by HEAD `/` (still a fixed-body 404). The record includes process start time, IP and port. A stale or reused PID alone cannot count as serving. No token is used in readiness probes. Successful binding precedes PID publication; shutdown removes only its own boot's record.

- **Linux:** Node `spawn(process.execPath, [main, "serve", "--port", port], { detached: true, stdio: "ignore" })`, then `unref()`. POSIX detached spawn creates a new session via setsid; no shell and no inherited SSH descriptors.
- **Windows:** `execFile("schtasks.exe", argv)` creates `mars-ram-links` with `/sc once /st 23:59 /rl LIMITED /f`; `/tr` directly quotes the Node and main paths (no cmd wrapper), then `/run`, then `/change /disable` in a finally block. The disabled task is not a logon service. It needs the user logged in, per T1 evidence; logged-out support is not claimed.

After the last link expires or is deleted the server closes and exits. Deletion is observed by the next valid-link request or the minute sweep; identity probes deliberately do not trigger cleanup. SIGINT/SIGTERM close the listener and remove its own PID record. Shutdown stops admissions immediately, closes idle connections and allows at most **3 seconds** for active connections before destroying streams and sockets. A stalled client cannot hold last-link self-exit open indefinitely. After restart nothing starts until the phone calls `ensure` with valid links. Concurrent starts may race to bind: only the successful listener publishes its PID record, and launchers check that listener's readiness.

### Stop and read-only status

`status` never initializes storage, changes ACLs, deletes expired metadata/copies, starts the server or changes tasks. It counts validated unexpired metadata as `links` and invalid/incomplete id entries as `invalid`, and uses the boot-identity HEAD probe (which does no store access). Offline/unconfirmed identity means `serving: false`. Invalid individual entries do not hide remaining valid links; an unsafe or unreadable storage root still fails rather than returning a misleading count. Unlike `list`, its output contains no URLs or tokens.

`stop` does not initialize or prune storage and can use the private record's validated Tailscale endpoint even when the Tailscale CLI is unavailable. It checks the live PID **and** the existing boot-identity endpoint immediately before stopping. On POSIX it sends SIGTERM only to that confirmed PID, then polls for endpoint disappearance (5-second polling budget, 100 ms between attempts; each probe has an absolute 1-second timeout, so the final probe can extend the budget by up to 1 second). No unchecked PID, process-name kill or forced-kill escalation is used. On Windows it ends the `mars-ram-links` scheduled task only after boot confirmation, and deletes that task. An unconfirmed boot is not terminated, but the named task registration is still removed without ending its process. Missing task is a no-op; task enumeration/removal errors fail the command. PowerShell invokes shell-free, fixed task commands; no URL or token is passed. Storage and existing link copies remain available for a later `ensure` until expiry.

## Layers, verification and limits

`src/core` owns create/list/delete/ensure, names, ids, expiry and content classification. Ports: LinkStore (copies and metadata), ServerLauncher (readiness and detached launch), Tailscale (host identity/address), clock and random. `src/adapters` implement private filesystem storage, permissions, HTTP, Tailscale CLI and platform launching; `src/main.ts` composes them. T6 owns the corresponding architecture/skill documentation update outside this package.

From the repository root: `pnpm test`, `pnpm test:contract`, `pnpm typecheck`. Tests use shared use-case fakes, real loopback HTTP, temporary private file stores and real Node CLI commands without links (so no detached process is launched). Windows task argv and path quoting are tested with fake execution. No test-only production bind escape exists.

**T7 still required:** real detached operation over SSH on Linux and Windows, task execution/quoting and ACL behavior on native Windows, tailnet DNS reachability from another device, and phone end-to-end expiry/delete. This package does not alter firewall rules, install dependencies, or promise availability while the computer is off/unreachable. It retains no expired-link history; the phone owns that history.
