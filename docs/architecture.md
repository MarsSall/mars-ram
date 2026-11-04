# Mars-RAM architecture (MVP)

**Status:** Approved (2026-10-18) · Answers to [`docs/prd.md`](prd.md) · Evidence: [`spikes/pi-bridge`](../spikes/pi-bridge/README.md)

The system has three parts: an **Android app**, a **host side** that runs on the user's computer, and a **protocol** between them. Each part follows hexagonal architecture: a core with the product rules, ports that describe what the core needs, and adapters that connect those ports to real technology. Everything travels over SSH across the user's tailnet; nothing runs on servers we operate.

```text
 Android phone                                   User's computer (tailnet)
┌──────────────────────────────┐               ┌─────────────────────────────────────────┐
│ Android app                  │               │  Pi TUI process (one per session)       │
│  UI ─► use cases ─► domain   │     SSH       │   └─ session bridge (Pi extension)      │
│          │ ports             │◄────────────►│        loopback HTTP + SSE, token       │
│  adapters: SSH, tunnel,      │  over         │                                         │
│  bridge client, SFTP,        │  Tailscale    │  Bridge registry   ~/.<appId>/bridges   │
│  terminal, Keystore, picker  │               │  Uploads           ~/.<appId>/uploads   │
└──────────────────────────────┘               │  Link server       tailnet IP only      │
                                               └─────────────────────────────────────────┘
```

## Naming

The product is **Mars-RAM**, described as **Remote Agent Manager**.

- Every technical identifier comes from one value, `APP_ID` = `mars-ram` in [`packages/protocol`](../packages/protocol/src/index.ts). It names the host folder (`~/.mars-ram/`, with the bridge registry in `~/.mars-ram/bridges`), the pairing links (`mars-ram://pair?p=…`), and the key comment in `authorized_keys`.
- The Expo slug and URL scheme are `mars-ram`; the host command is `mars-ram pair`.
- The Android application ID is `com.marssall.marsram`. It is final: Google Play does not allow changing it after the first release.

## Deployable parts

| Part | What it is | Lives in |
|------|------------|----------|
| Android app | The phone client: hosts, sessions, terminal, chat, attachments, links. React Native with Expo, in TypeScript | `apps/mobile/` |
| Session bridge | A Pi extension loaded into each Pi session; exposes that live session on `127.0.0.1` | `host/pi-bridge/` |
| Link server | A small host process that serves private links (R8) from its own folder, `~/.mars-ram/links` | `host/link-server/` |
| Host command | The command the user runs on the computer; today `pair`, which adds a phone by QR ([README](../host/cli/README.md)) | `host/cli/` |
| Protocol | Shared message and event schemas, versioning, and contract tests, in TypeScript used by both the app and the bridge | `packages/protocol/` |
| SSH native module | Kotlin code inside the app for SSH: connection, host identity, tunnels, and SFTP | `apps/mobile/modules/ssh/` |

The session bridge and the link server are separate on purpose: a bridge lives and dies with its Pi session, while a link must keep working for a day after the session that produced it has closed.

## Domain model

These concepts belong to the core and never mention SSH, HTTP, Pi APIs, or Android.

| Concept | Meaning |
|---------|---------|
| Host | A saved computer: name, tailnet address, user, pinned host identity. Credentials are referenced, never embedded. |
| Connection | An open SSH link to a host. Losing it does not end any session. |
| Agent session | One live Pi session on a host, identified by its Pi session ID. |
| Bridge instance | One running bridge for an agent session. A reload or restart creates a new instance with a new identity. |
| Event cursor | The last event number the app processed, valid only for one bridge instance. |
| Instruction | Text plus attachments the user sends to an agent session, with a delivery status. |
| Attachment | A file or image chosen on the phone, uploaded to the host before it is referenced. |
| Attention status | Working, Needs you, or Done, plus when it was last confirmed. |
| Private link | A short-lived link to one uploaded file, with an expiry. |
| Terminal session | The computer's Herdr, opened whole from the phone over SSH; the main screen of a session (R7, terminal first). |

### Rule: instruction delivery status

The bridge cannot return an ID for a sent message (spike proof 3), so the app infers status from events. Status only moves forward and never claims more than the events show (C5).

```text
draft ─► sending ─► submitted ───────────────► taken ─► answered
              │         └─► queued (agent busy) ─┘
              └─► failed (draft kept)       queued ─► returned to editor (run aborted before taken)
```

| Status | Evidence required |
|--------|-------------------|
| submitted / queued | The bridge accepted the request; `queued` when the agent was busy. |
| taken | A user `message_start` with matching content after submission. |
| answered | The following assistant `message_end`. |
| returned to editor | The message was queued, never taken, and the run settled as aborted. |
| failed | The request did not reach the bridge. The draft stays in the composer. |

### Rule: attention status

| Status | Derived from |
|--------|--------------|
| Needs you | A `ui_prompt_start` without a matching `ui_prompt_end`. |
| Working | `agent_start` seen and no `agent_settled` yet. |
| Done | `agent_settled` with nothing pending. |
| Stale | No live stream from the current bridge instance; shown with the last confirmed time. |

### Rule: reconnecting

1. Read the bridge registry to find the current instance for the session.
2. If it is the **same instance**, resume the event stream from the saved cursor. If the bridge reports a gap, reload from history.
3. If it is a **different instance** (reload, restart), discard the cursor and reload from durable history, then stream from the new instance.
4. Until one of these succeeds, the view is marked stale, never silently current.

## Android app

### Technology

- **React Native with Expo, in TypeScript.** The user has shipped an Expo app before, and TypeScript is shared with the bridge and the protocol.
- **SSH lives in our own native module**, written in Kotlin with the Expo Modules API and built on **sshj**, as Moshi does with its own native transport code. sshj is maintained, supports SFTP and local port forwarding, and since 0.30 accepts Android Keystore keys, whose private material the app cannot read. Apache MINA SSHD does not support Android.
- **The app's key is ECDSA P-256** (`ecdsa-sha2-nistp256`), generated inside the Android Keystore with the unlock requirement from PRD R1. Ed25519 keys in the Keystore are not usable through the platform provider yet. The rest of the app stays in TypeScript and reaches it only through the HostConnection, AttachmentTransfer, and Terminal ports.
- Because of that native code, the app runs as an Expo **development build**, not in Expo Go.

### Use cases

| Use case | PRD | Ports it uses |
|----------|-----|---------------|
| Add and connect to a host | R1 | HostCatalog, Credentials, HostConnection |
| List live sessions | R2 | HostConnection, SessionDiscovery |
| Follow a session | R3, R6 | SessionBridge |
| Send an instruction | R4 | SessionBridge, AttachmentTransfer |
| Stop the agent | R4 | SessionBridge |
| Attach files and images | R5 | MediaSource, Clipboard, AttachmentTransfer |
| Create and manage private links | R8 | AttachmentTransfer, LinkService |
| Open a session's terminal, or a computer's | R7 | HostConnection, Terminal, SessionBridge (best-effort session focus only) |

### Ports and adapters

| Port | Responsibility | MVP adapter |
|------|----------------|-------------|
| HostCatalog | Store hosts and their pinned identities | JSON file in the app's private documents directory |
| Credentials | Create, store, and delete SSH keys; rotate a computer to a new key | Android Keystore; key generations and rotation state in private files (`core/key-security.ts`), the host-side `mars-ram key add|remove` run over SSH exec |
| HostConnection | Connect, verify host identity, run commands, read files, open tunnels to the host's loopback | SSH native module ([README](../apps/mobile/modules/ssh/README.md)) |
| SessionDiscovery | Find live sessions and their bridge instances | `discoverBridges` reads the registry over SFTP, which works the same on Linux and Windows hosts |
| SessionBridge | Stream events, send, stop, read state and history, focus the session's own Herdr workspace/tab | HTTP and SSE through an SSH tunnel |
| AttachmentTransfer | Copy files to the host's uploads folder, and remove old ones | SFTP in the SSH native module: `uploadFile` writes a private `.part` and renames it, `removeFile`, and listings with modification times |
| LinkService | Create, list, and delete private links | The copy is staged by SFTP; the installed link server's `create`, `list`, `delete`, and `ensure` run over SSH exec with the paths from `host.json`, quoted for sh/fish or cmd; tokens never appear on a command line |
| Terminal | Run the computer's Herdr in a PTY and exchange its bytes: open with a size, write, resize, close, output and exit events | `TerminalChannel` in the SSH native module: a PTY plus an exec request (not a shell) limited to Herdr; see the [module README](../apps/mobile/modules/ssh/README.md) |
| MediaSource | Gallery, camera, file picker | Android system pickers |
| Clipboard | Read text, images, and files from the clipboard | Android clipboard |

Two adapters must handle what the phone run taught us: HostConnection retries a failed tailnet name lookup and can fall back to the Tailscale IP; SessionBridge treats a changed bridge instance as a reconnect, not an error.

### Sessions: implemented so far

The Sessions tab and the session screen use these modules in `apps/mobile/src`:

| Module | Does |
|--------|------|
| `core/host-connections.ts` | One SSH connection per saved computer, reused by every screen, with the key alias that computer trusts. The key is unlocked once for all computers; after the user cancels, the app does not ask again until they refresh by hand. Every fresh connection resumes a pending key rotation for that computer. |
| `core/key-security.ts` | The unlock setting and key rotation: a new Keystore key per change, then per computer add (with the old key) → prove with a fresh connection and the pinned identity → switch alias → remove the old key; resumable, and the old Keystore key is deleted only when no computer needs it. Missing or damaged metadata fails closed. |
| `core/session-list.ts` | Lists the live sessions of every computer, with its state: answering, no Pi open, not reachable, locked, or changed identity. Tunnels stay open between refreshes; a broken tunnel is replaced once; a registry entry whose bridge does not answer is never listed (PRD R2). |
| `core/session-order.ts` | Pure Sessions display ordering: a live global Needs you queue (rows name their computer), with new attention entries appended last and existing entries kept in order during automatic refreshes. Leaving attention restores a session's reserved computer-group position, or appends it if never placed there. Other group rows stay stable; gone sessions are removed. Focus and manual pull-to-refresh sort attention oldest-first using `lastActivityAt` as a waiting-time approximation, and visible computer-group rows by most recent activity. |
| `core/live-session.ts` | Follows one session: reads state, history, and state again so no event falls between the snapshot and the stream, then applies the stream. After a drop it reconnects on its own; if events were lost it reloads the conversation and says so. |
| `core/conversation.ts` | Pure model of what the screen shows: messages, tool runs summed up, status, messages queued from the phone, and a stop that Pi has not confirmed yet. |
| `core/herdr-terminal.ts` | Opens the computer's Herdr in a PTY at the path `mars-ram install` recorded in `~/.mars-ram/host.json` (bare `herdr` otherwise), reconnects on its own after a drop and attaches to the same Herdr, asks the session bridge once after each successful PTY open to focus its workspace/tab (never for standalone computer terminals; failures are silent and non-blocking), makes Herdr redraw after a capture gap, resets the emulator and requests a debounced full redraw instead of replaying a detached tail whenever a view returns to an open PTY (Chat return, WebView remount or app foreground; no nudge on first open), and pastes uploaded attachments' absolute paths at the cursor without Enter. |
| `core/terminal-controls.ts` | Messages between the screen and the offline xterm.js page in the WebView, the Ctrl state (tap arms one key, double tap locks) and the floating pill key row for each moment (normal ↑ ↓, keyboard open no arrows, PREFIX panel all four; ✥ always present). Width budgets include pill margins, borders and gaps at 360 dp. Enter and Backspace belong to the transparent D-pad cross. |
| `core/herdr-keys.ts` | Reads the computer's Herdr `[keys]` (`prefix`, `previous_agent`, `next_agent`) from its `config.toml` over SSH and turns Herdr key specs into bytes; defaults to `ctrl+b` and unset agent keys, never guesses an unknown spec. |
| `core/herdr-switcher.ts` | Runs `mars-ram herdr list` and `mars-ram herdr focus <workspace> [<tab>]` over SSH exec with the node and CLI paths from `host.json` (fixed verbs, validated ids, POSIX and cmd quoting) and parses the versioned JSON defensively; search and the Agentes grouping are pure functions. On the computer, `host/cli` runs Herdr's own CLI and `git rev-parse` with execFile (no shell), hard deadlines and bounded output (threat model). |
| `core/servers.ts` | Runs `mars-ram servers list` over SSH exec with the node and CLI paths from `host.json`, validates the versioned JSON strictly, keeps the last list per computer while refreshing, decides which servers can be opened, and owns the viewer's tunnel (`forwardLocal` with remote host 127.0.0.1 or ::1, closed on close, unmount and disconnect). The viewer (`ui/server-viewer.tsx`) loads only `http://127.0.0.1:<tunnel port>/` in an incognito WebView with no JS bridge; Android allows cleartext only to loopback (config plugin `plugins/with-loopback-network-security.js`). On the computer, `host/cli` reads `/proc` on Linux (no external binaries) and a fixed PowerShell script on Windows, keeps only the SSH user's own listeners, drops the bridge and link-server ports, and probes each port with one bounded HTTP request. |
| `app/session/terminal/[id].tsx`, `ui/floating-terminal-pad.tsx` | Design 05 presentation: cutout-aware camera-row name/▾ navigation to Sessions and status pill, floating rounded toolbar above safe-area/keyboard, left floating 💬 (tap inline chat, hold full chat; hidden for standalone terminals), transparent D-pad with translucent keys and an always-visible edge tab. |
| `ui/floating-session-chat.tsx`, `ui/use-composer-draft.ts`, `core/send-composer-draft.ts` | Floating chat reuses the terminal's existing `useLiveSession` stream and `send`, the full chat's `chat:<session>` draft and attachment picker/cards, and a shared send transaction. A per-session lock prevents duplicate sends; only an acknowledged unchanged draft is cleared, including across navigation and edits during send. Queued/returned labels come from bridge-backed conversation state. No speech dependency is installed; React Native's `Linking.sendIntent` only returns `Promise<void>`, not recognition results, so no microphone action is advertised. |
| `ui/terminal-status.ts` | The strip's status from the live bridge state: working with the localized activity phase, waiting for an answer, done; connection text whenever the bridge state is not live. |
| `adapters/bridge-http.ts`, `adapters/xhr-event-stream.ts`, `adapters/sse-parser.ts` | Bridge requests and the event stream through the tunnel. React Native's `fetch` cannot read a stream, so the stream uses `XMLHttpRequest` progress events. |

A message sent from the phone appears only after the bridge accepts it; if the request fails, the draft stays in the composer with an error (PRD R4).

### Attachments

Attachments (PRD R5) reuse these modules:

| Module | Does |
|--------|------|
| `core/attachment-draft.ts` | The attachments chosen for one draft: at most 10, each at most 25 MB, images told apart by type. Builds upload names that always pass the protocol's `UploadName` check: date, random part, and the cleaned original name. |
| `core/attachment-uploads.ts` | Checks that the bridge speaks protocol 1.2, copies every file into `~/.mars-ram/uploads`, and only then lets the chat send the names, or the terminal paste their absolute paths. A failed upload sends nothing, removes what that batch already copied, and leaves the draft as it was. |
| `core/attachment-retention.ts` | Once per computer per app opening, after the first connection, removes uploads older than the user's choice (1, 7, or 30 days, or never; 7 by default) and any `.part` older than an hour. It never delays or fails the connection. |

The app sends only upload names. The bridge turns them into paths on the computer, so Windows paths are built where they are used and image bytes cross the tunnel once.

## Session bridge (host)

The spike becomes this component. Its core keeps the event log and the instance identity; the Pi API is just one adapter.

| Port | Responsibility | Adapter |
|------|----------------|---------|
| PiSession | Observe events; send text and images; steer; abort; read state and history | Pi `ExtensionAPI` and `ExtensionContext` |
| Terminal | Read, type into, and focus only the session's inherited Herdr pane's workspace/tab | Bounded `execFile` without a shell; inherited `HERDR_PANE_ID`, never a request-selected target |
| EventLog | Numbered events with replay from a cursor and gap detection | In-memory ring buffer |
| Transport | Serve the protocol to one local client at a time | HTTP and SSE on `127.0.0.1`, random port |
| Registry | Publish how to reach this instance | `~/.<appId>/bridges/<instance>.json`, readable only by the host user (see Host platforms) |

Implemented in [`host/pi-bridge`](../host/pi-bridge/README.md), changed from the spike:

- Every response carries the **bridge instance ID** and the Pi session ID; each session start creates a new instance.
- Instances publish to a **shared registry directory**, so several sessions on one host are discoverable (R2). Entries and temporary files of dead bridges are pruned.
- A dialog reports the **tool call that opened it** when one is running, so "Needs you" can show which question is waiting (spike proof 9). Arguments over 16 KiB are replaced with a marker.
- The event stream sends events only as fast as the client reads them, so memory stays bounded for any replay size; a client that falls behind the retained log is disconnected and sees the gap when it reconnects with its cursor.
- The spike's test tool `bridge_ask_confirmation` is not shipped.
- User and assistant messages are sent whole; only tool output is shortened, to 500 characters.
- The state reports when the session last changed, so the list can say how long ago something happened.
- Since protocol 1.4, the core keeps the latest **activity phase id** and emits an `activity` event only when it changes (null clears). Agent start and settle clear it. The Pi adapter reads Gentle's optional process-local ODD registry using `sessionManager.getSessionId()`, feature-detects its `get` method, catches failures, and accepts only bounded phase ids. Without a valid registry phase, pure core inference uses read/search/list tools → `exploring`, edit/write → `implementing`, and recognizable bash test/typecheck/build commands → `checking`; other tools keep the previous phase. No phase is inferred from assistant prose or tool output.
- Since protocol 1.2, messages and terminal text may name **attachments** in `~/.<appId>/uploads`. The bridge resolves each name inside that folder only: links, hard links, a linked folder, and unfinished `.part` files resolve to nothing, and a file is read through the handle that was checked. Images are attached natively when the model accepts them and Pi does not block images (up to 50 MB of images per message); every file's absolute path is appended to the text.

### Terminal routes

The authenticated bridge keeps `GET /terminal` and `POST /terminal/input` for older apps. Since protocol **1.3**, `POST /terminal/focus` (no body) reads its inherited pane's tab, validates the IDs and their workspace, then focuses that workspace and tab. Success returns the standard envelope and `status: "focused"`; outside Herdr it returns 404. The app ignores an older bridge's 404 and all other focus failures. No request can choose a pane, workspace, or tab. Herdr focus is shared between clients, so opening a session on the phone also moves the PC's view, as accepted in terminal-first S11; standalone “Abrir terminal” leaves focus alone.

## Host platforms

The MVP supports **Linux** and **native Windows** hosts; WSL counts as Linux and macOS comes later. Both must pass the end-to-end phone run before the MVP is done. Platform differences live only in host-side adapters and in how the app talks to the host; the cores do not change.

| Concern | Linux | Windows | Rule |
|---------|-------|---------|------|
| Reading host files from the app | Shell commands work | The SSH shell is `cmd` or PowerShell | The app reads host files over SFTP, never with shell commands |
| Restricting the registry and token files | `chmod 700` / `600` | Replace the whole access list with one rule for the user's SID (.NET `SetAccessControl`, which writes only the access list; `Set-Acl` needs `SeSecurityPrivilege` once an elevated process created the folder), dropping inherited and explicit rules for others | A file-permissions adapter per platform; verified on both |
| Keeping the link server running | Started on demand over SSH as a detached process (`setsid`) | Started on demand over SSH as a scheduled task with `/rl LIMITED`, because processes started from a Windows SSH session die with it; needs the user logged in | Decided 2026-10-23, confirmed by the user 2026-10-25 ("Solo cuando hay links vigentes"): no permanent service; it exits when the last link expires or is deleted, and the app restarts it after a reboot when links are still valid (R8) |
| Installing the bridge | `pi install` per Pi home | Same, with `pi.cmd` resolved to its Node entry and run without a shell; refused in an elevated terminal | `mars-ram install` (see Host command) |
| Terminal with Herdr | `herdr` at the absolute path install records, run over SSH with a PTY | `herdr.exe` the same way, with cmd as the SSH default shell; PowerShell as the default shell is not supported yet | Linux verified from the phone (2026-10-23); Windows pending |
| SSH server | Usually installed | OpenSSH Server is an optional Windows feature | Diagnostics detect it and explain how to enable it |

## Host command (install, uninstall, doctor)

[`host/cli`](../host/cli/README.md) is what the user runs on the computer. Besides `pair`:

| Port | Responsibility | Adapter |
|------|----------------|---------|
| InstallPorts | Find Pi homes (`~/.pi/agent`, `~/.gentle-shell/agent`), build the self-contained copy, register and remove it, keep the record | Files under `~/.mars-ram/` (`pi-bridge/`, `install.json`, fixed `pi-bridge.staging` and `pi-bridge.previous`), `pi install` / `pi remove` with `PI_CODING_AGENT_DIR` |
| DoctorPorts | Read-only checks: Pi, install state, live bridges, permissions, Tailscale, SSH forwarding and paired keys, and on Windows the OpenSSH service and default shell | `execFile` without a shell, file reads, `sc.exe` and `reg.exe` |
| Project workspace and Git | Resolve a Herdr workspace's active pane and read its Git metadata and changes | Bounded, shell-free Herdr and read-only Git subprocesses |
| Project files | List and read files inside the resolved project and stage a private-link copy | Contained filesystem access, checked file handles, and the link server's staging directory |

Rules: no administrator rights; linked paths are refused before any change; only homes this command registered are recorded and removed, and the copy stays while any home still uses it; intent is written before calling Pi, so an interrupted run is finished or undone by the next one. The doctor changes nothing and reports what it cannot determine as a warning.

## Link server (host)

| Port | Responsibility | Adapter |
|------|----------------|---------|
| LinkStore | Keep each copy with its metadata, read through a checked handle; delete it | `~/.<appId>/links/<id>/` (`content` + `link.json`), staging in `.staging/`; private permissions |
| HttpServer | Serve only registered copies, only on the tailnet address | HTTP bound to the Tailscale IPv4; `GET/HEAD /l/<token>` |
| ServerLauncher | Start, find, and stop the detached server | `setsid` on Linux, an on-demand limited scheduled task on Windows; a pid record plus a boot identity confirms the process |

It never resolves a path from a request: a link token maps to one stored copy, or to nothing (PRD R8). Tokens are 32 random bytes made on the computer and never logged; management uses a separate non-secret id. PNG, JPEG, GIF, and WebP (by their bytes) display inline; everything else downloads. Downloads stream with limits (4 at a time, 10-minute deadline, 30 s stall timeout) and stop when their link expires or is deleted. Links last 24 h; the server exits when none remain. Commands and limits: [`host/link-server/README.md`](../host/link-server/README.md).

## Protocol

- One versioned schema for requests, responses, and events, shared by the bridge and the app, with contract tests on both sides.
- Every response carries `protocolVersion`, `bridgeInstanceId`, and `sessionId`.
- Additive changes only within a major version; the app rejects a bridge with an unsupported major version with a clear message.
- Protocol **1.4** adds optional `activity: string | null` to state and an `activity` event with the same field. Phase ids match `^[a-z][a-z-]{0,31}$` (maximum 32 characters, no newline); null clears, and absence in older snapshots means null to clients. Clients localize ids rather than receiving display text; older clients ignore the new event. Existing 1.3 snapshots remain valid.

## Security model

| Concern | Decision |
|---------|----------|
| Who may connect | Only holders of an SSH key authorized on the host. The app generates its key in the Android Keystore; the private key never leaves the phone. |
| Which host is real | The host identity is pinned at first connection, shown as a fingerprint, and a change is never accepted silently (R1). |
| Who may use a bridge | It listens only on `127.0.0.1`, behind a per-instance random token in a registry file readable only by the host user (mode `0600` on Linux, a user-only ACL on Windows). |
| What a link exposes | One uploaded copy, on the tailnet only, for one day (R8). |
| What the bridge can do | Only what the protocol defines: send, steer, stop, and read. No command execution. Its only file access is reading attachments by name inside the uploads folder. |
| Where attachments live | `~/.<appId>/uploads`, created private by the app (`0700`, files `0600`; on Windows it inherits the user-only folder). Removed after the retention the user chose. |

## Testing strategy

- **Domain:** unit tests for the delivery-status, attention, and reconnect rules, using recorded event sequences from the spike as fixtures.
- **Ports:** each port has a fake used by use-case tests, so the core is tested without SSH, Pi, or Android.
- **Contracts:** protocol contract tests run against the real bridge in a disposable Pi session, like the spike.
- **End to end:** a scripted phone run over Tailscale, like `phone-test.sh`, before each milestone.

## Repository layout

```text
apps/mobile/           React Native and Expo app
apps/mobile/modules/ssh/  Kotlin SSH native module
host/pi-bridge/        session bridge (Pi extension)
host/link-server/      private link server
packages/protocol/     shared schemas and contract tests
docs/                  PRD, architecture, decisions
spikes/                feasibility code, never imported by the product
```

## Decisions

| Decision | Choice | Date |
|----------|--------|------|
| Android technology | React Native with Expo, plus a Kotlin SSH native module | 2026-10-18 |
| Terminal fallback multiplexer | Herdr first; tmux can be added later as a second adapter | 2026-10-18 |
| Terminal fallback approach | Remote control of the session's Herdr pane through the bridge (screen snapshots, text, keys), not a PTY with `herdr session attach`: the computer's layout stays untouched and reconnecting is reading again. Replaced on 2026-10-23 | 2026-10-22 |
| Terminal first | A real terminal is the main screen of a session, like Moshi: the phone runs the computer's whole `herdr` client in a PTY over SSH, with its own theme and every pane, rendered by xterm.js in a WebView; the chat is secondary. The PC's Herdr may rearrange while the phone is attached, which the user accepted | 2026-10-23 |
| How the host side is installed | The session bridge as a Pi package; the link server copied by `mars-ram install`, which records `node`, `linkServer`, and `linkPort` in `host.json` | 2026-10-18, updated 2026-10-25 |
| Host systems | Linux and native Windows; WSL as Linux; macOS later | 2026-10-19 |
| SSH library and key type | sshj with an ECDSA P-256 key in the Android Keystore, proved on a real phone before building on it | 2026-10-19 |

## Skills per area

Project-local agent skills in `.agents/skills/` that guide development in each area. Names describe the area, never the product.

| Skill | Guides |
|-------|--------|
| `hexagonal-architecture` | Hexagonal boundaries, where new code belongs, and how ports and adapters are named |
| `expo-mobile` | React Native and Expo patterns, development builds, and platform APIs (Keystore, pickers, clipboard) |
| `kotlin-ssh-module` | The Kotlin SSH module: Expo Modules API, threading, host identity, tunnels, and SFTP |
| `pi-session-bridge` | Pi extension lifecycle, events, and the limits found in the spike |
| `bridge-protocol` | Schema changes, versioning, and contract tests |
| `remote-access-security` | SSH keys, host identity, bridge tokens, and link exposure |
| `port-fakes-testing` | Fakes for ports, event fixtures, and the end-to-end phone run |
| `mobile-ux-design` | Screen states, honest status, one-hand use, accessibility, and approving screens before building them |
| `host-link-server` | The private link server: tokens, expiry, tailnet-only listening, and safe downloads |
| `release-and-distribution` | Local builds, versions, the Android signing key, and publishing |
| `host-install-and-diagnostics` | Installing on Linux and Windows hosts and the diagnostic command |
| `product-security` | Threat model, data on the phone, logs, dependencies, secrets, permissions, and content sent to the agent |
