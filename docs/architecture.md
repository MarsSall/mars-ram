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
│  terminal, Keystore, picker  │               │  Uploads  <tmp>/<appId>-<uid>/uploads   │
└──────────────────────────────┘               │  Link server       tailnet IP only      │
                                               └─────────────────────────────────────────┘
```

## Naming

The product is **Mars-RAM**, described as **Remote Agent Manager**.

- Every technical identifier comes from one value, `APP_ID` = `mars-ram` in [`packages/protocol`](../packages/protocol/src/index.ts). It names the host folder (`~/.mars-ram/`, with the bridge registry in `~/.mars-ram/bridges`), the pairing links (`mars-ram://pair?p=…`), and the key comment in `authorized_keys`.
- The Expo slug and URL scheme are `mars-ram`; the host command is `mars-ram pair`.
- Pairing offers in `packages/protocol`: version 1 is a Tailscale offer (unchanged, optional MagicDNS name); version 2 is a ZeroTier offer with `network: "zerotier"`, an IPv4 literal address and no MagicDNS name. `decodeNetworkPairingUri` reads both and is what the app uses (`core/pairing.ts`, `core/pair-link.ts`); `decodePairingUri` reads only version 1 and asks for a newer app otherwise, like apps released before ZeroTier do.
- The Android application ID is `com.marssall.marsram`. It is final: Google Play does not allow changing it after the first release.

## Always-attentive host notification ports (T6)

The link-server core defines `NotifyRegistrationStore` (bounded per-phone records,
private persistence) and `NoticeDelivery` (bounded TCP attempts). The notifier
adapter integrates registry discovery and loopback state/events, projecting only
sequence/type/outcome into pure `NoticeRules`. These are separate from private-link
storage and downloads; the policy never sees agent text. Secrets arrive only on SSH stdin; the SSH source address, not an
input field, selects the destination. Bridge tokens stay in the local adapter.
A registration keeps the existing link-server process alive even without links;
unregistering the last phone restores the existing link-only expiry lifecycle.
No permanent OS service or boot startup is added. The installer materializes the
canonical dependency-free protocol notice modules in the standalone server copy;
fingerprints cover those bytes too, without requiring TypeBox or a checkout.

Notice wire v1 is independent of bridge protocol 1.6 (no bridge version bump).
`session-notice.ts` defines fixed-order UTF-8 JSON-array canonical bytes and
WebCrypto HMAC-SHA256, a 4096-byte line limit and a ±120-second replay window.
The shared fixture is `packages/protocol/test/fixtures/session-notice-v1.json`.
The phone's ALWAYS path observes the `AlwaysNoticeSource` port, separate from
`SessionEventSource` and SSH leases. `AlwaysSecretPersistence` owns encrypted,
backup-excluded per-computer records; pure `AlwaysNotifyVault` owns registration,
forgetting and durable replay policy. The TCP adapter projects authenticated
notices into existing `SessionAlert` values. These ports do not grant SSH access.

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

- `core/link-policy.ts` is the pure external-link allowlist; Expo Router's `app/+native-intent.tsx` applies it on cold and warm system links, allowing Inicio, pairing confirmation with exactly one `p` parameter, or a narrowly validated `notice` URI resolved to a saved host and live session. `core/notification-routing.ts` decodes the exact UTF-16-hex boundary once; unknown/ended targets and URI-unrepresentable IDs fall back to Inicio. Internal navigation is unchanged.

### Technology

- **React Native with Expo, in TypeScript.** The user has shipped an Expo app before, and TypeScript is shared with the bridge and the protocol.
- **SSH lives in our own native module**, written in Kotlin with the Expo Modules API and built on **sshj**, as Moshi does with its own native transport code. sshj is maintained, supports SFTP and local port forwarding, and since 0.30 accepts Android Keystore keys, whose private material the app cannot read. Apache MINA SSHD does not support Android.
- **The app's key is ECDSA P-256** (`ecdsa-sha2-nistp256`), generated inside the Android Keystore with the unlock requirement from PRD R1. Ed25519 keys in the Keystore are not usable through the platform provider yet. The rest of the app stays in TypeScript and reaches it only through the HostConnection, AttachmentTransfer, and Terminal ports.
- Because of that native code, the app runs as an Expo **development build**, not in Expo Go.

### Native connection ownership (notification groundwork)

The Android `HostConnection`/`Credentials` adapters now use an application-process
`ConnectionManager` singleton. Its pure Kotlin `ResourceLeases` owns the clients,
forwards and lifecycle lock. `acquire(UI | SERVICE)` creates an isolated lease;
`connect(lease, options)` opens a client for it. A native caller may explicitly
`lease.retain(connectionId)` to share an existing connection. No sharing is inferred
from host names. Access, disconnect and forward closure require the caller's lease.
`disconnect` releases only that owner's hold and forwards; the last hold closes the
client. A transport failure invalidates all holders. Closing a lease is idempotent
and rejects/disposes late connection and forward publication. The lock guards
bookkeeping only: every client disconnect, forward close and detach callback (which
closes terminal channels) runs after it is released, because closing an SSH channel
can wait for the host. A slow close never stalls another connect, adoption or
`isConnected`. Each `LoopbackForward` follows the same rule: its monitor guards only
the closed flag and link registration, so a link accepted after close starts is
refused and closed, and its channels close after the monitor is released.

`SshModule` retains the same JS API and owns its terminal channels. Its `OnDestroy`
closes those channels and releases only its UI lease: a service-held client and
service-owned forwards survive; releasing a service lease cannot close UI resources.
The manager does not retain an Activity or React context. SSH work remains on IO.
`SessionWatchService` now owns separate SERVICE leases through the native
`SessionEventSource` port. Force-stop/process death still ends these connections
and notifications; there is no automatic restart (notifications S3/S5).

For non-Activity callers, `KeystoreKeys.withoutPrompt(alias)` returns typed
`Ready`, `NeedsUnlock`, `Missing`, or `Invalidated`; `signWithoutPrompt` performs an
actual Keystore signature with the same typed failure states. Neither creates a
key nor opens UI. Android, not a cached app timestamp, decides whether an existing
key is usable: keys without authentication binding can sign, while auth-bound keys
require a valid 300-second unlock window (S6). SSH preflight is not an authorization
grant: expiry during authentication still returns the existing `UNLOCK_REQUIRED`
error. Private key material never leaves Keystore, and host pinning and loopback-only
forward restrictions are unchanged.

### Native session notifications (T2b)

`SessionEventSource.configure(hosts) / events(): Flow<WatchEvent> / close()` is the
native observation port. Its events contain only snapshot state, instance-scoped
sequence numbers, projected event types/outcomes, removals and host connectivity;
never tokens or agent text. The SSH adapter uses each host's saved key alias and
pinned fingerprint, a SERVICE lease, bounded SFTP registry reads (64 KiB per
entry, 1,000 directory entries), loopback forwards, Bearer-authenticated `/state`
and `/events?since=`. It re-enumerates every 30 seconds; HTTP redirects are refused.
Protocol 1.x is accepted; the native decoder projects the fields needed from the
canonical TypeScript protocol without changing its version (1.6). The pure Kotlin
registry decoder checks required fields and their actual JSON types without string
coercion, including finite numbers, integer port/pid bounds, nonempty IDs and the
major-version compatibility check. It accepts arbitrary protocol-valid ID strings
and ignores additive fields; notification constraints never filter registry IDs.
Registry tokens
exist only in adapter memory and HTTP authorization headers, never logs, intents,
notification bodies, or status responses.

The Expo API adds `startSessionWatch({ appId, hosts: [{ hostId, connection }] })`,
`stopSessionWatch()` and `sessionWatchStatus()`. `connection` includes the actual
per-host key alias (including a previous generation during rotation), address,
optional fallback, port, username and **required** pinned fingerprint. Start
requires a resumed Activity and already-granted/enabled notifications; it never
prompts or saves opt-in. The TS `SessionNotificationSource` consumer shape is
configure/getStatus/subscribe. `core/notifications.ts` now owns persisted opt-in, serialized mode changes, permission outcomes and per-host registration behind NotificationPorts; `adapters/native-notifications.ts` implements Android permission, preferences and native control. Settings uses the shared observable use case, not native APIs. Host deletion revokes before removing the catalog entry.

Pure Kotlin `SessionWatchRules` is the notification/lifetime policy. Initial
snapshots and replay-gap resnapshots are silent; a gap never infers a finish from
`lastOutcome`. Event deduplication is by (host, instance, seq). `prompt_start`
alerts needs-response. A non-aborted `agent_settled` alerts finished for completed,
failed for failed, and nothing for aborted/unknown future outcomes. Registry
`protocolVersion` travels with both snapshots and events. Only bridges below 1.6
use the compatibility fallback: missing outcome with `aborted: false` means finished.
For 1.6+ a missing outcome is unknown and produces **no alert**, since current
bridges intentionally omit unknown outcomes. The SSH adapter probes connectivity
through registry discovery; after
three failed host attempts it reports connection-lost once per outage, retries
at 30-second intervals, and resets the outage latch on successful discovery.
A stale individual bridge is not evidence that the host is lost.

The last meaningful state event across all sessions (agent start/settle,
prompt start/end, activity phase, session start, session removal or a changed
snapshot attention state) resets a monotonic two-hour deadline. Content chunks,
keepalives, duplicate events and registry polling do not. With no working or
waiting sessions, including empty startup, a **two-minute grace** ends the service;
the timer checks every five seconds. Explicit JS stop cancels all observation.
Prompt-free reconnect first uses `KeystoreKeys.signWithoutPrompt` with the saved
alias, then the ConnectionManager's prompt-free SSH authentication. NeedsUnlock
posts one localized unlock notice per host and parks that host, never opening biometric
UI in the background. When the visible app then connects to that host, the source
resumes it at once and adopts the app's live connection; other failures keep their
own backoff. The connect is matched against the hosts the running source was
configured with, so during a reconfiguration it never resumes the previous source by
the newer configuration's hosts.

The config plugin declares an unexported, non-sticky `connectedDevice` foreground
service with FOREGROUND_SERVICE, FOREGROUND_SERVICE_CONNECTED_DEVICE,
CHANGE_NETWORK_STATE (Android's prerequisite) and POST_NOTIFICATIONS. A low-importance
ongoing channel is separate from session alerts. Notification text is project name
plus state only, localized for Spanish/English from the app's resolved language (`setNotificationLanguage` and start configuration); no agent text.
Taps launch the main Activity with `sessionWatchHostId` and
`sessionWatchBridgeInstanceId` extras encoded as lowercase UTF-16 code-unit hex
(four digits per code unit), plus `sessionWatchIdEncoding: "utf16-hex"`. This
lossless boundary encoding permits every protocol-valid ID (even lone surrogates)
without interpreting it as a path/URI or creating delimiter collisions. Internal
identity and deduplication always use the original strings. The launch Intent also carries the equivalent `notice` URI for Expo cold/warm linking; the exact hex is decoded once before live lookup. Permission requests and denial/settings actions are implemented in T3. Registry tokens containing CR/LF remain schema-valid but are rejected
separately by the HTTP adapter before creating an Authorization header. Foreground-start denials are reported via the native result/status.
Play declaration draft and threat-model/privacy updates describe these entry points and permissions. Preview-device verification and the Play evidence video remain T5; there is no delivery promise after force-stop or process death. Android 10+ pre-pause re-arms an idle-expired while-working watch while the Activity is still RESUMED; older versions use onActivityPaused while still STARTED/visible (an internal lifecycle-only exception, never onStop/background). Process-local arming is cleared on explicit stop and is not persisted as a restart mechanism.

### Always-attentive native listener (T6 / S7)

`startSessionWatch` accepts either `{ appId, mode: "while-working", hosts:
[{hostId, connection}] }` (mode may be omitted for existing callers), or
`{ appId, mode: "always", hosts: [{hostId, hostKeyId}] }`. `hostKeyId` is the
saved/pinned SSH fingerprint returned by host registration, not a hostname.
Duplicate host ids or fingerprints are rejected. ALWAYS never constructs an SSH
event source, takes a connection lease, checks an SSH key, or starts keepalives
or the SSH watch's idle deadline. Its status has no per-host connectivity claims:
a passive listener cannot detect a dead computer or emit connection-lost alerts.
A mutex serializes full old-mode cleanup before
new-mode observation, including rapid mode changes. Start still requires a
resumed Activity and enabled/granted notifications. A separate MIN-importance
ongoing channel is used; session alerts and project-plus-state text are shared.
The service remains non-sticky, unexported, and has no boot receiver or wake lock.

`TcpAlwaysNoticeSource` enumerates up `tun`/`tunN` interfaces and binds only their
literal 100.64.0.0/10 or fd7a:115c:a1e0::/48 addresses, port 47812 (both families
when present, at most two addresses; one failing to bind keeps the other). Peers on
these listeners must belong to the Tailscale ranges. Since ZeroTier phase 2 it also
binds the active non-Tailscale VPN's IPv4 (ZeroTier; prefix /8–/30) and admits only
peers inside that subnet. There is no wildcard, LAN or loopback fallback. With no
eligible address the start fails closed with `PRIVATE_NETWORK_REQUIRED` (older
builds reported `TAILSCALE_REQUIRED`; the app accepts both). A NetworkCallback
rebinds with backoff when the VPN changes; while running with no VPN the status is
`state: "running"`, `code: "PRIVATE_NETWORK_REQUIRED"`, `networks: []`. Status
`networks: [{ kind: "tailscale" | "vpn", address, prefix }]` says where the phone
listens now (missing in older builds). Each listener handles
one accepted client at a time with backlog four, one ≤4096-byte newline-terminated
frame and an absolute two-second read deadline. All socket/crypto/storage work
runs on IO. Socket closure cancels blocked accept/read; there is no idle polling.
Rebinding is best effort; no delivery guarantee is made.

`AlwaysNoticeVerifier` checks wire v1, strict field types and string/size bounds,
fixed-order canonical JSON-array UTF-8 bytes and JCA HmacSHA256 using
`MessageDigest.isEqual`. Only configured fingerprints select secrets. Unknown or
invalid MACs cannot advance replay state. Accepted instance sequences and the
±120-second freshness window are checked before an atomic encrypted cursor
commit and before alert publication. Cursors survive service/process restart,
retain the latest accepted timestamp, and fail closed at 128 live instances per
computer (4096 in-memory cursors overall). Kotlin tests consume the original
`packages/protocol/test/fixtures/session-notice-v1.json` via Gradle resources;
there is no second fixture. `org.json:json:20240303` is a JVM-test-only dependency
for Android's platform JSON API; no runtime dependency was added.

`registerAlwaysNotify(hostId)` returns `{secret,port}` for the caller to send
through authenticated SSH stdin; it does not itself connect or enable the mode.
Repeated registration returns the same per-computer 32-byte SecureRandom secret.
`forgetAlwaysNotify(hostId)` deletes its local secret and replay state; T3 must
also unregister on the host, and call forgetting when deleting/changing a host.
The native code retains no secret cache, checks the secret generation again at
cursor commit, and emits no secret/token/payload diagnostics. AtomicFile records
are AES-256-GCM encrypted, bound to hostId as associated data, stored under
`noBackupFilesDir`, limited to 64 computers, and sealed by a non-exportable
Android Keystore AES key. Corrupt records/missing keys fail closed rather than
silently regenerating registered secrets.

**Trade-off:** this AES key is deliberately **not user-auth-bound** so a listening
service can decrypt notification secrets while SSH's 300-second authentication
window is closed. App-process compromise can therefore decrypt these secrets
without a new user prompt; it does not unlock or weaken the SSH key (S6).
`isIgnoringBatteryOptimizations()` reports the system state;
`openBatteryOptimizationSettings()` opens this app's details screen
(`ACTION_APPLICATION_DETAILS_SETTINGS`) and falls back to the general
`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` list. No restricted direct-request
permission is declared. UI consent/SSH calls remain T3. Force-stop, process death,
Doze, OEM restrictions and battery behaviour still require closed-test device
measurement; no notices after force-stop/process death are promised (S5).

**Phone network checks (connection wizard).** `phoneNetworkState()` reports
`tailscaleInstalled` (PackageManager lookup of `com.tailscale.ipn`), `tailscaleOn`
(a `TRANSPORT_VPN` network visible to the app with an IPv4 address in
100.64.0.0/10), `zerotierInstalled` (lookup of `com.zerotier.one`), `vpnOn` (any
`TRANSPORT_VPN` network visible to the app; Android does not tell which app owns
it, and runs one VPN at a time) and `privateDnsActive` (`LinkProperties.isPrivateDnsActive` on any
network, in automatic or provider-hostname mode: a tester's pairing hung with
automatic mode on; omitted below Android 9). The pure rules live in
`PhoneNetwork.kt` (JVM-tested). `installTailscale()` opens `market://` then the
https Play page; `openTailscale()` launches the app or falls back to its store
page; `installZeroTier()` and `openZeroTier()` do the same for ZeroTier;
`openPrivateDnsSettings()` opens `ACTION_WIRELESS_SETTINGS`, then Settings,
because Android has no public Private DNS screen. The config plugin
`plugins/with-tailscale-queries.js` (registered in `app.config.ts`) adds
`<queries>` entries for `com.tailscale.ipn` and `com.zerotier.one` (only those
packages, never `QUERY_ALL_PACKAGES`) and declares the normal
`ACCESS_NETWORK_STATE` permission explicitly; no runtime permission is requested.

**Pairing transport per network.** A Tailscale offer (version 1) is unchanged: the
app requires a MagicDNS name, probes the SSH port at the IP and then at the name
(Private DNS check), and posts the key with `fetch` to
`http://<magicdns>:<pairPort>/pair`, which the cleartext rule for `ts.net` allows.
A ZeroTier offer (version 2) has no name, and Android's network security config
cannot allow cleartext to IP ranges, so instead of opening cleartext app-wide the
key goes through one narrow native function, `postPairingOverVpn(address, port,
body, timeoutMs)` (`VpnPairing.kt`, a raw `Socket` like `probe`). It refuses
(`INVALID_REQUEST`) anything but an IPv4 literal, a port in 1–65535, a positive
wait and a body of at most 4 KiB; it refuses (`NOT_ON_VPN`) unless a
`TRANSPORT_VPN` network visible to the app has an interface subnet or a specific
route covering the address (a default route does not count, so a full-tunnel VPN
does not qualify), and it binds the socket to that VPN network so the request
cannot leave over Wi-Fi or mobile data. It sends exactly one `POST /pair` to the
offer's address and pair port, never resolves a name and never follows a
redirect; one absolute deadline (the offer's remaining lifetime, capped at ten
minutes) covers connect, send and the wait for the user's answer at the
computer; it reads at most 16 KiB and accepts a final HTTP/1.x status with a
Content-Length, chunked (what Node sends) or close-delimited body in strict
UTF-8. Every failure resolves (`UNREACHABLE`, `TIMEOUT`, `BAD_RESPONSE`); the
app reads the body with the same `PairingResponse` decoder as Tailscale. Before
sending, the app probes the SSH port at the offer's address. The QR's host-key
pin and the computer's confirmation question are the same for both networks.
The pure rules (IPv4 literal, prefix match, request bytes, response parsing and
bounds) are JVM-tested in `VpnPairingTest.kt`. No new permission:
`ACCESS_NETWORK_STATE` is already declared.

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
| HostCatalog | Store hosts and their pinned identities, and each host's network (`network: "zerotier"`; missing means Tailscale, so older catalogs need no migration) | JSON file in the app's private documents directory |
| Credentials | Create, store, and delete SSH keys; rotate a computer to a new key | Android Keystore; key generations and rotation state in private files (`core/key-security.ts`), the host-side `mars-ram key add|remove` run over SSH exec |
| HostConnection | Connect, verify host identity, run commands, read files, open tunnels to the host's loopback | SSH native module ([README](../apps/mobile/modules/ssh/README.md)) |
| SessionDiscovery | Find live sessions and their bridge instances | `discoverBridges` reads the registry over SFTP, which works the same on Linux and Windows hosts |
| SessionBridge | Stream events, send, stop, read state and history, focus the session's own Herdr workspace/tab | HTTP and SSE through an SSH tunnel |
| SessionEventSource (native) | Observe all configured hosts through configure/events/unlocked/close; technology-free event projection | `SshSessionEventSource`, SERVICE leases, SFTP registry + HTTP/SSE through loopback forwards |
| SessionNotificationSource / NotificationPorts | Configure observation, status, opt-in persistence, permission and per-host registration/revocation; pure `NotificationSettings` serializes transitions | Native Expo start/stop/status, RN notification permission, private preference file; a future relay can replace observation |
| NotificationRegistration | Register/revoke a phone via the existing authenticated host connection; secrets only on stdin | Installed node/CLI from host.json, fixed notify verbs, bounded SSH `execWithInput`; response identity must match the saved pin |
| AttachmentTransfer | Copy files to the host's uploads folder, and remove old ones | SFTP in the SSH native module: `uploadFile` writes a private `.part` and renames it, `removeFile`, and listings with modification times |
| LinkService | Create, list, and delete private links | The copy is staged by SFTP; the installed link server's `create`, `list`, `delete`, and `ensure` run over SSH exec with the paths from `host.json`, quoted for sh/fish or cmd; tokens never appear on a command line |
| Terminal | Run the computer's Herdr in a PTY and exchange its bytes: open with a size, write, resize, close, output and exit events | `TerminalChannel` in the SSH native module: a PTY plus an exec request (not a shell) limited to Herdr; see the [module README](../apps/mobile/modules/ssh/README.md) |
| MediaSource | Gallery, camera, file picker | Android system pickers |
| Clipboard | Read text, images, and files from the clipboard | Android clipboard |
| HostReleaseRegistry | Read the latest published host release; no host or user data in the request | Bounded HTTPS GET of `https://registry.npmjs.org/mars-ram/latest` (`adapters/npm-host-release.ts`) |
| HostReleaseCache | Persist the last registry attempt timestamp and last validated latest release | Private app JSON file (`adapters/file-host-release-cache.ts`); global metadata, not associated with a computer |
| SeenBuildStore | Remember the last build whose «Novedades» were seen; tell a fresh install from an app used before the feature | Private app JSON file (`adapters/file-seen-build.ts`); "used before" means an earlier preference or catalog file exists |
| TerminalFontStore | Persist the one terminal font size (8–28, 14 when missing or invalid) shared by Settings › Terminal and pinch zoom; `core/terminal-font.ts` reads it once before any terminal opens and coalesces fast pinch saves so the last size wins | Private app JSON file (`adapters/file-terminal-font.ts`) |
| TerminalKeysStore | Persist the one global terminal key layout (bar order, 9 D-pad slots, custom buttons with name ≤ 8 and text ≤ 512); `core/terminal-keys.ts` reads it once before any terminal opens, repairs fixed keys (Ctrl, PREFIX, Teclado), drops unknown ids and invalid buttons, falls back to the original keys on damaged or other-version data, and coalesces saves so the last layout wins | Private app JSON file `terminal-keys.json` (`adapters/file-terminal-keys.ts`) |
| AppUpdateSource | Ask Google Play whether a newer version exists, start its flexible update, install it once downloaded | Google Play In-App Updates in the SSH native module (`checkAppUpdate`, `appUpdateProgress`, `startFlexibleUpdate`, `completeUpdate`, `onAppUpdateStatus`; `adapters/play-app-updates.ts`) |
| AppUpdateCheckStore | Persist the last Play check time and its answer | Private app JSON file (`adapters/file-app-update-check.ts`) |
| PhoneNetwork | The connection wizard's phone checks (Tailscale installed, Tailscale on, Private DNS active, ZeroTier installed, any VPN on) and the system screens it opens | SSH native module (`phoneNetworkState`, `installTailscale`, `openTailscale`, `installZeroTier`, `openZeroTier`, `openPrivateDnsSettings`; `adapters/native-phone-network.ts`). Malformed answers, failures and non-Android platforms read as the non-blocking state (Tailscale present and on, Private DNS unknown, ZeroTier facts left out so the core reads ZeroTier as unknown); opening a screen never rejects. Android does not say which app owns a VPN, so the core (`zeroTierPhone` in `core/phone-network.ts`) counts ZeroTier as on when a VPN is active and the phone has no Tailscale address |
| NetworkChoiceStore | Remember the wizard's last network choice (Tailscale or ZeroTier; Tailscale until the user picks) | Private app JSON file (`adapters/file-network-choice.ts`); read and write failures never block the wizard (`core/network-choice.ts`) |
| DictationEngine | Record and transcribe on the phone; download, verify and remove the voice model | whisper.rn (Parakeet) and the PCM recorder; the model's system download through Android's DownloadManager in the SSH native module (`startModelDownload`, `modelDownloadStatus`, `cancelModelDownload`; `adapters/on-device-dictation.ts`) |

ZeroTier (`odd/tasks/zerotier.md`, phase 2 `odd/tasks/zerotier-phase2.md`): a ZeroTier computer gets private links and Siempre atento like a Tailscale one; phase 1 refused both (`TAILSCALE_ONLY`) and that gate is gone. Tailscale computers send byte-identical commands.

ZeroTier phase 2 (`odd/tasks/zerotier-phase2.md`), host contract: for a ZeroTier computer the link commands take `--network zerotier --address <the saved ZeroTier IPv4>` after the port (`create --staged <name>`, `list`, `delete <id>`, `ensure`), and the link URL is `http://<that IPv4>:47811/l/<token>`; Tailscale computers send the same commands as before, with no network options. `mars-ram notify register --json` needs no option: the computer tells a ZeroTier registration from the SSH connection and answers with an extra `"network": "zerotier"` field.

App side: `LinkService` derives the network from the saved computer (`hostNetwork`) and passes `{ network: "zerotier", address }` to `buildLinkCommand`, which accepts only a literal IPv4 (`isIpv4` from `@workspace/protocol/private-network`) and appends the two options to `ensure`, `create`, `list`, `delete` and the first-connect `restore`. Host failures map only from fixed stderr lines, never echoed: `Invalid option.` (a host before ZeroTier links) → `UPDATE_REQUIRED` («Actualizá mars-ram en la computadora para usar links por ZeroTier.»), `ZeroTier address not found…` → `ZEROTIER_ADDRESS_NOT_FOUND` («La computadora no tiene esa dirección de ZeroTier…»); anything else stays `LINK_FAILED`. Siempre atento registers every computer with the same `notify register --json` call; `parseNotifyRegistration` requires `"network": "zerotier"` in a ZeroTier computer's answer and no `network` in a Tailscale one, and a ZeroTier computer answering `{"v":1,"ok":false,"code":"NOTIFY_FAILED"}` (what hosts before ZeroTier notices answer a non-Tailscale phone) is shown as «Actualizá mars-ram…». Android runs one VPN at a time, so Ajustes › Notificaciones (mode always) shows per computer «Por Tailscale»/«Por ZeroTier» and, from the native status `networks`, «No llega mientras Tailscale/ZeroTier esté apagado» (`alwaysReachability` in `core/notifications.ts`: a Tailscale computer needs a `tailscale` entry, a ZeroTier computer a `vpn` entry whose subnet holds its address; no claim while the watch is not running or the build reports no `networks`). «Registro confirmado» never means reachable. The card polls the status every 2 s while visible, so native rebinds show up. «Mientras trabajan» is unchanged (SSH).

Two adapters must handle what the phone run taught us: HostConnection retries a failed tailnet name lookup and can fall back to the Tailscale IP; SessionBridge treats a changed bridge instance as a reconnect, not an error.

### Voice model download (dictation)

The voice model (356 MB, pinned Hugging Face URL, `DICTATION_MODEL` in `core/dictation.ts`) downloads in Android's **DownloadManager**, so it keeps going when the sheet closes, the screen changes, the app is in the background or closed; the system shows its progress in a notification and resumes it after interruptions. `ModelDownloads.kt` keeps one download: its id is saved in SharedPreferences, and a start returns the download already pending, running, paused or finished instead of starting a second one; only https and a plain file name are accepted (`validModelDownload`, JVM-tested with the status mapping). It writes `<file>.download` into `getExternalFilesDir(null)`, which needs no storage permission; `VISIBILITY_VISIBLE_NOTIFY_COMPLETED` needs no `DOWNLOAD_WITHOUT_NOTIFICATION`, and the notification is posted by the system's download provider, so no `POST_NOTIFICATIONS` is asked. No permission is added (INTERNET was already declared).

The adapter verifies a finished file (size and MD5), copies it next to the model in the app's private documents folder and renames it into place, then removes the download from DownloadManager, which deletes its copy and its notification. A failed or mismatching download is removed and reported once as DOWNLOAD_FAILED. `modelReady()` does this first, so a download that finished while the app was closed is put in place when a mic mounts or Settings opens. `ModelDownload` in the core is what the sheet and the Settings card watch: watching polls the progress once a second, closing or unmounting only stops watching, and only «Cancelar descarga» calls `cancelDownload`; engine calls run one at a time, so a cancel pressed during the start removes what it began.

### Host update checks (R1/R2)

`core/host-update.ts` owns bounded version JSON parsing, semantic-version ordering and `ok` / `soft` / `required` policy. `MINIMUM_HOST_VERSION` is **0.1.6**, the first release with private links and Siempre atento over ZeroTier and a project browser that refuses hard links; 0.1.5 (`uploads-dir`, `pair-zt`) and 0.1.4 (the first with `version --json`) were earlier minimums. Bump it only when new app functionality requires a newer host. Missing legacy commands count as below a minimum ≥ 0.1.4; malformed/transport results are unknown and `dev` never warns. This is advisory: no command installs anything automatically or prevents sessions/terminals from working.

`core/host-updates.ts` probes with HostConnection and the validated paths/quoting shared with the Herdr switcher. Every new pooled connection is probed independently of its maintenance callbacks; concurrent probes share a result, and focus/automatic refreshes have the existing 10-second floor. Host results are memory-only and keyed by saved computer, discarded when the saved catalog no longer includes it. Computadoras refreshes on focus; Inicio checks with its existing session refresh. Both show the shared `ui/host-update-notice.tsx`, using the existing selectable/copyable CommandBlock and directing users to the computer's terminal. Session summaries derive their independent `/reload` hint from registry `protocolVersion` minor versus the app's protocol.

LatestHostRelease uses HostReleaseRegistry and HostReleaseCache: one global timestamp and last validated latest release in private app storage, no per-computer data. The last attempt is persisted **before** a request, so failures/offline also consume the daily budget across app openings. In-flight requests are shared. If recording that attempt fails, no request is made. Failures are silent; cached public release metadata can still support the soft notice. npm metadata never decides the minimum warning and never triggers execution. The HTTPS adapter has a 5-second timeout, refuses declared bodies over 64 KiB and rejects oversized/malformed metadata before parsing; RN fetch buffers undeclared bodies before the size check.

### App updates: «Novedades» and the Play update notice (S2/S3)

The installed build comes from the native module's `appBuild()` (PackageManager versionCode and versionName); Expo's build number is only a fallback because it can be empty on release builds, and the app version is the fallback key when no build number is known. Ajustes → Acerca de shows the same value as «Compilación».

`core/release-notes.ts` bundles each release's notes (Spanish and English, «Nuevo» and «Arreglos»), keyed by versionCode; no network. `core/whats-new.ts` (`WhatsNew`) decides what to show against SeenBuildStore: a fresh install records the build and shows nothing; an update shows every entry newer than the last seen build up to this one; an app used before the feature shows this build's entry; «Entendido» (or back) records the build. Storage failures never block the app. The root layout's `WhatsNewGate` shows it once; Ajustes → Acerca de → «Novedades» lists every entry.

`core/app-updates.ts` (`AppUpdates`) first asks AppUpdateSource for the current flexible download on every app start (`appUpdateProgress`, which also listens again while a download runs): downloading or downloaded is shown regardless of the daily cache. Otherwise it checks availability once per app start and at most once a day: the attempt is recorded before asking, a recent answer is reused only while its versionCode is newer than this build, and if the attempt cannot be recorded nothing is asked. States are idle, available, downloading and downloaded; dismissal lasts for this app start, and a finished download shows again. `onAppUpdateStatus` reports how a download ended: downloaded offers the restart; failed or canceled return to available with «Actualizar» (failed adds a short message), then Play is asked again and the notice hides if the update is no longer offered. An event that arrives while Play is still answering (the start-up status and check, or «Actualizar») is held and applied after the answer, the latest one winning, so a stale answer never leaves a finished download shown as downloading; natively the install listener is registered before Play is asked (`listeningFirst`), and a listener added only for a check is removed again unless a started flow owns it. Native mapping is the pure `AppUpdatePolicy.kt` (JVM-tested): builds whose installer is not Google Play (`com.android.vending`, from `getInstallSourceInfo` on API 30+, else `getInstallerPackageName`) never ask Play; missing Play, timeouts and errors resolve to `available:false`; only flexible updates are offered. The library adds no permission (only Play Core's unexported dialog activity); Play performs the check. `ui/app-update-notice.tsx` appears in Inicio and in Ajustes → Acerca de.

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
| `core/servers.ts` | Runs `mars-ram servers list` over SSH exec with the node and CLI paths from `host.json`, validates the versioned JSON strictly, keeps the last list per computer while refreshing, decides which servers can be opened, and owns the viewer's tunnel (`forwardLocal` with remote host 127.0.0.1 or ::1, closed on close, unmount and disconnect). The viewer (`ui/server-viewer.tsx`) navigates only to `http://127.0.0.1:<tunnel port>/` (subresources are not filtered) in an incognito WebView with no JS bridge; Android allows cleartext only to loopback and to MagicDNS names under `ts.net`, which Tailscale QR pairing uses for its key request (config plugin `plugins/with-loopback-network-security.js`; ZeroTier pairing uses the native request above instead). On the computer, `host/cli` reads `/proc` on Linux (no external binaries) and a fixed PowerShell script on Windows, keeps only the SSH user's own listeners, drops the bridge and link-server ports, and probes each port with one bounded HTTP request. |
| `core/pair-link.ts`, `app/pair.tsx` | A pairing link (`<scheme>://pair?p=…`, any app scheme) is rebuilt into the QR's canonical `mars-ram://pair?p=…` URI and decoded on the phone without network; the route asks «¿Agregar esta computadora?» with the name and address (the MagicDNS name, or the ZeroTier IPv4), then runs the same `usePairingRunner` as the QR scan (`app/add-computer/index.tsx`). Unknown links land on `app/+not-found.tsx`. |
| `app/session/terminal/[id].tsx`, `ui/floating-terminal-pad.tsx` | Design 05 presentation: cutout-aware camera-row name/▾ navigation to Sessions and status pill, floating rounded toolbar above safe-area/keyboard, left floating 💬 (tap inline chat, hold full chat; available for standalone terminals when the focused pane matches a live bridge), transparent D-pad with translucent keys and an always-visible edge tab. The terminal WebView asks Android's keyboard for no suggestions or autocorrect (like Termux): xterm.js cannot replace text it already sent, so a picked suggestion duplicated input. HTML attributes do not stop Gboard, so `patches/react-native-webview@14.0.1.patch` sets the editor type to a visible password without suggestions, only for WebViews whose `applicationNameForUserAgent` contains `MarsRamTerminal`; the server viewer keeps normal suggestions. |
| `ui/floating-session-chat.tsx`, `ui/use-composer-draft.ts`, `core/send-composer-draft.ts` | Floating chat reuses the terminal's existing `useLiveSession` stream and `send`, the full chat's `chat:<session>` draft and attachment picker/cards, and a shared send transaction. A per-session lock prevents duplicate sends; only an acknowledged unchanged draft is cleared, including across navigation and edits during send. Queued/returned labels come from bridge-backed conversation state. No speech dependency is installed; React Native's `Linking.sendIntent` only returns `Promise<void>`, not recognition results, so no microphone action is advertised. |
| `app/terminal-keys.tsx`, `ui/terminal-keys-editor.tsx`, `ui/terminal-keys-draft.ts`, `ui/custom-button-form.tsx`, `ui/terminal-key-view.ts` | Ajustes › Terminal › «Personalizar teclas» (custom-terminal-keys S2–S5): a local draft over `core/terminal-keys.ts` edits (refusals shown as plain messages), a space meter from `remaining`, drag (long press, then the screen root takes the touch) with a tap alternative, and «Guardar cambios» as the only write (`terminalKeys.set`). The terminal bar renders `visibleBar` and the D-pad `padSlots` of the saved layout, live; catalog keys send through `catalogKeyBytes` (Ctrl and cursor mode as typed keys; agent keys need the computer's Herdr binding), custom buttons through `customPress` (with «Enter al final» only a 500 ms hold sends). |
| `ui/terminal-status.ts` | The strip's status from the live bridge state: working with the localized activity phase, waiting for an answer, done; connection text whenever the bridge state is not live. |
| `adapters/bridge-http.ts`, `adapters/xhr-event-stream.ts`, `adapters/sse-parser.ts` | Bridge requests and the event stream through the tunnel. React Native's `fetch` cannot read a stream, so the stream uses `XMLHttpRequest` progress events. |

A message sent from the phone appears only after the bridge accepts it; if the request fails, the draft stays in the composer with an error (PRD R4).

### Attachments

Attachments (PRD R5) reuse these modules:

| Module | Does |
|--------|------|
| `core/attachment-draft.ts` | The attachments chosen for one draft: at most 10, each at most 25 MB, images told apart by type. Builds upload names that always pass the protocol's `UploadName` check: date, random part, and the cleaned original name. |
| `core/attachment-uploads.ts` | Checks that the bridge speaks protocol 1.7 and asks the host for the folder with `mars-ram uploads-dir --json` (an older bridge or CLI gets «update the app and mars-ram» instead of attachments), copies every file into that absolute folder, and only then lets the chat send the names, or the terminal paste their absolute paths. A failed upload sends nothing, removes what that batch already copied, and leaves the draft as it was. |
| `core/attachment-retention.ts` | Once per computer per app opening, after the first connection, removes uploads in the folder `mars-ram uploads-dir` names older than the user's choice (1, 7, or 30 days, or never; 7 by default) and any `.part` older than an hour. It never delays or fails the connection. |

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
- Since protocol 1.2, messages and terminal text may name **attachments** in the uploads folder (`~/.<appId>/uploads` until 1.6; since 1.7 the private temp folder, see below). The bridge resolves each name inside that folder only: links, hard links, a linked folder, and unfinished `.part` files resolve to nothing, and a file is read through the handle that was checked. Images are attached natively when the model accepts them and Pi does not block images (up to 50 MB of images per message); every file's absolute path is appended to the text.

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
| PairingNetworkPorts | Where `pair` listens: the Tailscale IPv4 and MagicDNS name by default, or with `pair-zt` a ZeroTier IPv4 (`core/pairing-network.ts` decides none/one/several/`--address`) | `tailscale status --json`; `os.networkInterfaces()` filtered to ZeroTier interfaces (`zt*` Linux, `feth*` macOS, `ZeroTier One […]` Windows), no root |
| DoctorPorts | Read-only checks: Pi, install state, live bridges, permissions, Tailscale (an `ok` line, not a problem, when ZeroTier is connected: everything works over ZeroTier), ZeroTier addresses, SSH forwarding and paired keys, and on Windows the OpenSSH service and default shell | `execFile` without a shell, file reads, `os.networkInterfaces()`, `sc.exe` and `reg.exe` |
| Project workspace and Git | Resolve a Herdr workspace's active pane and read its Git metadata and changes | Bounded, shell-free Herdr and read-only Git subprocesses |
| Project files | List and read files inside the resolved project and stage a private-link copy | Contained filesystem access, checked file handles, and the link server's staging directory |

Rules: no administrator rights; linked paths are refused before any change; only homes this command registered are recorded and removed, and the copy stays while any home still uses it; intent is written before calling Pi, so an interrupted run is finished or undone by the next one. The doctor changes nothing and reports what it cannot determine as a warning.

## Link server (host)

| Port | Responsibility | Adapter |
|------|----------------|---------|
| LinkStore | Keep each copy with its metadata, read through a checked handle; delete it | `~/.<appId>/links/<id>/` (`content` + `link.json`), staging in `.staging/`; private permissions |
| HttpServer | Serve only registered copies, only on a private-network address | HTTP bound to the Tailscale IPv4, or with `--network zerotier --address` to that verified ZeroTier IPv4; `GET/HEAD /l/<token>` |
| ServerLauncher | Start, find, and stop the detached server, one process per listening address | `setsid` on Linux, an on-demand limited scheduled task on Windows; a pid record plus a boot identity confirms the process (`server.pid.json` and task `mars-ram-links` for Tailscale, `server-zerotier-<ipv4>.pid.json` and `mars-ram-links-zerotier-<a-b-c-d>` per ZeroTier address) |
| ZeroTier | Accept only an IPv4 currently on one of this computer's ZeroTier interfaces | `os.networkInterfaces()` with the shared rules of `packages/protocol/src/private-network.ts` (also used by `pair-zt`, doctor and notify registration) |
| Notify registrations | Keep one private record per phone; the Tailscale process notifies records without a network, each ZeroTier process the records of its address (`notifiedBy` in `core/notify-registration.ts`) | `~/.<appId>/notify/<sha256>.json`, 0600; signed TCP line to the phone's address |

It never resolves a path from a request: a link token maps to one stored copy, or to nothing (PRD R8). Tokens are 32 random bytes made on the computer and never logged; management uses a separate non-secret id. PNG, JPEG, GIF, and WebP (by their bytes) display inline; everything else downloads. Downloads stream with limits (4 at a time, 10-minute deadline, 30 s stall timeout) and stop when their link expires or is deleted. Links last 24 h; the server exits when none remain. Commands and limits: [`host/link-server/README.md`](../host/link-server/README.md).

### Pane-bound terminal chat (R2, R7)

`core/pane-chat.ts` maps the focused Herdr pane to a live discovered bridge on the same host, for both Pi and Gentle Shell. `core/session-list.ts` carries the optional `/state` pane identity. `ui/use-pane-chat.ts` refreshes discovery and the existing Herdr list every ten seconds while visible/foreground, and after explicit switcher focus. It uses the focused workspace/tab's focused pane, or its sole pane when focus metadata is unavailable; ambiguous split panes never guess. External/keyboard focus changes are observed at the next refresh.

Legacy route binding is retained when pane metadata is unavailable (older CLI without pane arrays), and when the route session is still live but its older bridge reports no pane: such a session cannot be placed, so it keeps today's behaviour unless a newer bridge owns the focused pane. Otherwise known-but-ambiguous/empty focus yields no chat, and a concrete pane requires a matching live bridge; a route session that disappeared from discovery is dropped. Standalone terminals need a matching bridge. Unmatched panes hide the handle and close floating chat; another matching pane replaces the chat. Cached bindings are tagged by both host and route session, so a same-host route change cannot reuse the previous session while discovery loads. Full-chat navigation carries the mapped session's discovered project/cwd, retaining original route params only for that route's session. A keyed floating composer and key-tagged live snapshot prevent previous-session drafts/messages flashing during a switch. Chat rebinding does not recreate the PTY or re-run session focus.

## Protocol

- Protocol **1.7** moves attachments out of the home folder; requests and responses are unchanged. The host names the folder: `mars-ram uploads-dir --json` prints `{"v":1,"path":"<absolute>"}` (exit 0) or `{"v":1,"error":"unsafe_folder"|"unavailable","message":"…"}` (exit 1), decoded by `decodeUploadsDir`. The path policy in `@workspace/protocol/uploads-folder` is shared by the CLI and the bridge: `/tmp/mars-ram-<uid>/uploads` on Linux and macOS (`TMPDIR` ignored), each component created `0700` and then required to be a real folder owned by the user with no group/other bits (never `chmod`-ed into place); `%TEMP%\mars-ram\uploads` on Windows, refusing reparse points and relying on the user temp folder's ACL. The bridge re-checks the policy before each lookup and never reads `~/.<appId>/uploads`, so an app before 1.7 gets the usual `not_found` refusal for its attachments. The app uses attachments only when `supportsTempUploads(protocolVersion)` (minor ≥ `UPLOADS_IN_TEMP_MINOR`) and the host CLI answers `uploads-dir`; otherwise it asks to update the app and mars-ram. `UPLOADS_DIRECTORY` remains only as a deprecated export.

- Protocol **1.6** adds optional `outcome: "completed" | "failed" | "aborted"` to `agent_settled`, retaining `aborted` and `pendingMessages`. The Pi adapter reads the last assistant in the latest `agent_end.messages`: `stop` (or compatible `end_turn`) means completed, `error` means failed, `aborted` means aborted; the settled `aborted` flag takes precedence. Other/missing stop reasons remain unknown (field omitted); an individual tool error is not a failed run. Evidence resets on agent start, settle, and session replacement. `/state` optionally carries `lastOutcome: { outcome, seq }` for the latest settle, even after its event leaves the replay buffer; an unknown latest settle clears it. The seq belongs only to this bridge instance, and a new run can be working while the snapshot still describes its preceding settle. App session lists and live views carry this evidence without changing UI status; old payloads remain valid and older clients ignore the additive fields.

- Protocol **1.5** adds optional `terminalPane: string` to `/state`, retaining `terminal: boolean`. This is the Terminal port's inherited, validated pane id captured at session start (for example `w2G:p2`), not a new Herdr probe or request-selected target. It is absent outside Herdr and on older bridges. Same-major negotiation continues accepting older/newer minor versions; older clients ignore the new field. The Terminal port exposes this captured identity as optional read-only `paneId`.

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
| What the bridge can do | Only what the protocol defines: send, steer, stop, and read. No command execution. Its only file access is reading attachments by name inside the uploads folder, after re-checking that folder's policy. |
| Where attachments live | Since 1.7, outside the home folder: `/tmp/<appId>-<uid>/uploads` (Linux/macOS; `TMPDIR` is ignored so the CLI and the bridge agree), created `0700` by `mars-ram uploads-dir` and refused when linked, owned by someone else, or open to group/others; `%TEMP%\<appId>\uploads` on Windows, refused when a reparse point, under the user-only temp ACL. Files `0600` (`.part`, then rename without overwrite). Removed after the retention the user chose, by the system's temp cleanup, and by uninstall; `mars-ram install` deletes the legacy `~/.<appId>/uploads` (regular files only, never following links). |

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
