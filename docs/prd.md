# PRD: Mars-RAM — Remote Agent Manager (MVP)

**Status:** Approved (2026-10-18) · **Product name:** Mars-RAM · **Description:** Remote Agent Manager

An Android app that turns the phone into an extension of the developer's computer. The user keeps working with the Pi sessions already running there exactly as if they were at the desk, and in some moments better: reading the live conversation, sending instructions, images, and files, seeing which session needs them, and dropping into the real terminal when needed. It works over the user's own network, with no servers operated by us.

This document defines **what** the MVP does and **why**. Technical design comes later and must answer to it.

## Problem

Development work with Pi is tied to the desk. The sessions, the terminal, the files, and the clipboard all live on the computer, so stepping away means stopping work: the developer cannot tell whether an agent finished, is blocked, or went off track, and cannot correct it, feed it a screenshot, or hand it a log.

The phone should not be a remote control with a reduced feature set. It should be a second screen of the same workspace, where the developer continues the same work with the same sessions. The phone also brings things the desk lacks, such as a camera and the ability to follow work from anywhere.

A plain mobile SSH client technically reaches the computer, but steering a coding agent through a raw terminal on a phone keyboard is slow, and sharing screenshots or files with it is almost impossible. The reference product, Moshi, solves much of this, but its events, inbox, notifications, and file links run through a vendor-operated cloud. We want the same continuity without anyone having to operate central infrastructure.

## Target user

A developer who runs Pi on a computer they control and wants to keep working with those sessions from an Android phone, with the same continuity they have at the desk.

## Product constraints

| # | Constraint | What it means |
|---|------------|---------------|
| C1 | No infrastructure we operate or pay for | No mandatory accounts or central servers. Any third-party dependency is disclosed to the user. |
| C2 | One live session | The phone works on the same Pi session already running. It never starts a hidden second agent or forks the conversation. |
| C3 | Tailscale network | In the MVP, the phone reaches the host only over the user's Tailscale tailnet, which works away from home without opening ports. Tailscale is a third-party dependency that we disclose to the user. We do not build our own VPN or relay, and the network stays a replaceable part of the design so other networks can be added later. |
| C4 | The host is authoritative | The phone shows a view of the host's state. Anything that acts on a session is checked against the host's current state first. |
| C5 | Honest status | The app distinguishes *sent* from *queued* from *accepted* from *finished*, and never shows an outcome it has not confirmed. |
| C6 | Desk parity first | When the phone acts on a session, it behaves the way Pi does at the computer. Anything the chat cannot do yet stays possible through the terminal fallback. |

## MVP scope

| ID | Capability | In one line |
|----|------------|-------------|
| R1 | Connect to a host | Save a computer and connect to it securely. |
| R2 | List live Pi sessions | See which Pi sessions are running on that host. |
| R3 | Follow a session | Read the conversation and watch it update live. |
| R4 | Send instructions | Write to that same session, including while it is busy, and stop it. |
| R5 | Send attachments | Attach images and other files from the gallery, camera, clipboard, or file picker. |
| R6 | Attention status | See at a glance whether each session is working, needs you, or is done. |
| R7 | Terminal | The main screen of a session: the computer's whole Herdr over SSH, with a key toolbar and a hidden D-pad made for the phone; the chat is secondary. |
| R8 | Private links | Upload an image or file and get a link, served by the user's own computer, that opens on the user's tailnet. |

### Out of scope for the MVP

- iOS.
- Notifications while the app is closed.
- Answering approvals or questions from the chat view (they are answered in the terminal fallback).
- Voice input and dictation (planned, see below).
- Diff viewer (planned, see below) and browser preview.
- Public links that open outside the user's tailnet. Moshi's Files feature relies on its own cloud, which conflicts with C1; R8 covers links within the user's tailnet instead.
- Networks other than Tailscale (plain LAN, other VPNs).
- Alternative transports (Mosh, Eternal Terminal) and multiplexer navigation (workspaces, windows, panes).
- Usage and rate-limit tracking (planned, see below).
- Custom terminal shortcuts, configurable gestures, and configurable toolbar or D-pad buttons (Moshi's shortcut builder).

### Planned after the MVP

Agreed to add later (2026-10-20):

- **Diff viewer:** review the files the agent changed.
- **Answer questions and approvals from the phone:** show the full question and its options and answer them in the app, not only in the terminal fallback.
- **Usage and quotas per provider:** how much of each model provider's limits the sessions are using.
- **Voice input and dictation.**
- **Start a new Pi session in a recent folder,** like Moshi's recent directories.
- **Visual polish (frontend phase):** the navigation and organization are approved (2026-10-20); the look keeps Moshi's style direction but needs a dedicated design pass.

## Requirements

### R1 · Connect to a host

- **QR pairing, the main way to add a computer:** the host tool shows a QR with the host's address, user, identity, and a one-time code. The phone scans it and sends its public key straight to the computer over the tailnet; no cloud is involved, and the host identity comes from the QR, so the user does not compare fingerprints by hand. The QR is a temporary access token and expires.
- **Fallbacks:** copy the app's public key and paste it on the computer, with instructions per system (including the Windows administrators file); or type the SSH password once so the app installs its key — the password is never stored.
- The user saves a host with a name, address, port, and username.
- Credentials are kept in Android secure storage, separate from host details. Deleting a host deletes its credentials.
- The app generates a dedicated SSH key for itself; it never leaves the phone.
- **Device unlock to use the key:** on by default, so someone holding the unlocked phone cannot open sessions on the computer. The user confirms with a fingerprint, face, PIN, or pattern, at most once per app opening or connection rather than on every action. The user can turn it off in settings.
- Turning the unlock requirement on or off creates a new key, because Android fixes this property when the key is created. The app authorizes the new key on each paired computer by itself with the current key (one unlock), proves it with a fresh connection, and only then removes the old key; a computer that is off finishes the change when it next answers. No pairing again. Settings shows each computer's state ([unlock toggle](../odd/tasks/unlock-toggle.md)).
- **Errors:** a phone that is not connected to the tailnet, an unreachable host, failed authentication, or a changed host identity each show a specific message. A changed host identity is never accepted silently.

### R2 · List live Pi sessions

- The app lists the Pi sessions currently running on the host, with their project directory and status.
- Each session shows which terminal it runs in (for example its Herdr pane), so opening the terminal fallback lands on that exact pane. A separate tab lists the host's terminal sessions (Herdr first, then tmux) to open any terminal directly, as Moshi does.
- A saved session that is not running is never presented as if it were live.
- **Empty state:** explains the likely reason (Pi is not running, or the host-side integration is not active).

### R3 · Follow a session

- The app shows the user's messages, the agent's replies, and a summary of tool activity, updating live while the agent works.
- After a disconnection, the app reconnects to the same session and shows its completed history. If live updates may have been missed, the app says so.
- Anything the chat cannot represent points the user to the terminal fallback.

### R4 · Send instructions

- The user sends text to the selected session, and it appears in that same session on the computer.
- The composer accepts text pasted from the phone's clipboard.
- **While the agent is busy:** the message is queued as a steering message, exactly as pressing Enter in Pi does at the computer. It enters after the current response and its tool calls finish, and the app shows it as queued until the agent takes it.
- **Stop:** while the agent is working, the user can request a stop, equivalent to pressing Escape in Pi. The app shows the stop as requested until the agent confirms it stopped. If the agent does not react, the app points the user to the terminal fallback.
- After a stop, messages that were still queued are not shown as delivered. Pi returns them to its editor, and the app makes that visible.
- **Errors:** if delivery fails, the draft is kept and the user is told. A message is never shown as accepted before the host confirms it.

### R5 · Send attachments

- The user attaches images or other files (for example PDFs, logs, archives, configuration files, or code) to an instruction.
- **Sources:** gallery, camera, clipboard (when it holds an image or file), and the Android file picker.
- Before sending, the user sees each attachment, with a preview for images, and can remove it.
- Attachments are placed on the host through the user's own connection, in a known location the user can find and delete. The instruction references them so the agent can open them like any local file.
- In the chat, images travel with the instruction so the agent sees them directly. In the terminal fallback, attachments added in the terminal composer are sent as their file paths, together with the text.
- **Errors:**
  - If an upload fails, nothing is sent and the draft is kept.
  - If the session's model does not accept images, or images are blocked by configuration, the app says so instead of implying the agent saw the image.
  - A file over the size limit is rejected with a clear message.

### R6 · Attention status

- Each session shows one of: **Working**, **Needs you** (waiting for an answer or approval), or **Done** (no more automatic work pending).
- Status is visible from the session list and inside the session.
- The app shows when the status was last updated, and marks it as stale while disconnected.
- Background notices are **off by default**, with three opt-in Settings choices: **Off**, **While working**, and **Always attentive**. Android 13+ notification permission is requested on enabling; denial leaves the choice off, with an explanation and a system-settings button.
- **While working** watches every saved computer over SSH and posts project-plus-state notices when a session finishes, fails, needs a response, or a computer stops responding. It stops two minutes after no session is working/waiting, or after two hours without a meaningful state change. Starts are visible-Activity-only; Android 10+ re-arms an idle-expired watch immediately before the Activity pauses; older versions use the paused-but-still-visible edge, never onStop or an already-background app.
- **Always attentive** registers a per-computer notice secret over SSH and listens only on the phone's Tailscale address. The existing link-server process watches all local sessions and sends authenticated notices inside the tailnet; no external relay or Firebase. It cannot detect a disconnected computer. Tailscale must stay on; Settings shows the battery-optimization state and opens this app's system details screen, falling back to the general exclusion list. Doze/OEM/battery behaviour is measured during closed testing, not guaranteed.
- The ongoing foreground-service notice is separate from session alerts. Alert text contains only project name and state, never agent text. Tapping an alert validates the live host/session before opening it; removed/ended targets go to Inicio. Native texts follow the app's Spanish/English choice.
- Reconnect follows each host's actual saved SSH key: unlock-bound keys reconnect only within Android's 300-second authentication window; otherwise an unlock notice opens the app. Always-attentive notification secrets do not unlock SSH.
- Force-stop or process death ends notices; there is no boot/sticky restart or promise of delivery after either. Changing away from Always attentive or forgetting a computer attempts remote unregister and deletes its local secret/cursors. An offline host can retain its remote record; local revocation still rejects it.

### R7 · Terminal

Since 2026-10-23 the terminal is the main screen of a session, like Moshi ([terminal first](../odd/tasks/terminal-first.md)).

- Opening a session shows, full screen, a real terminal over SSH running the computer's Herdr whole, with its own theme and every pane. Computers also offer "Abrir terminal" with no Pi running.
- Approvals, questions, and any interaction the chat does not support are handled here. 💬 floats at the left above the key bar: a tap opens a rounded chat box above the keyboard, and holding it opens the full bridge conversation. Standalone computer terminals have no 💬; a session outside Herdr opens the chat with a note.
- Since 2026-10-27 ([thin chrome, design 05](../odd/tasks/session-thin-chrome.md)) the screen hides Android's status bar and uses the camera row: the computer's name and ▾ at the left open Sessions, nothing sits under the centre cutout, and a rounded status pill at the right shows a braille spinner with its phase (explorando…, verificando…), ✗ when a question waits, a green ✓ when done. Android Back returns to Sessions; there is no separate back button.
- After a dropped connection, the app reconnects on its own and attaches to the same Herdr.
- The user types directly in the terminal. ＋ first on the key bar uploads files (same sources as R5) and pastes their absolute paths at the cursor, without Enter. The optional floating chat box instead sends text and attachments through the same bridge path and session draft as the full chat: drafts survive closing and failures, and host-confirmed queued messages are labelled. Its controls are ＋ (attachments), × (close), and accent ↑ (send). No voice button is shown: no installed module returns speech recognition results to JavaScript; adding that capability needs a native result/recognizer adapter and any required microphone permission, separately approved.
- **Key toolbar**, a floating rounded pill with 44 dp-high rounded keys, inset from the screen edges and above Android's home indicator or the keyboard: `＋ Ctrl PREFIX Esc Tab 📋 <arrows> ✥ ⌨`. 📋 is labelled Pegar/Paste. All moments fit 360 dp without horizontal scrolling. The arrows change with the moment: ↑ ↓ normally, none with the keyboard open, all four arrows with the PREFIX panel open; ✥ stays in every moment. Ctrl applies to the next key after a tap and stays on (🔒) after a double tap. Font size by pinching; landscape works.
- **PREFIX** sends the computer's own Herdr prefix, read from its `config.toml` (`~/.config/herdr` on Linux, `%APPDATA%\herdr` on Windows; Herdr's default `ctrl+b` otherwise), and opens the keyboard; the key never shows which prefix it is. A long press offers "Agente anterior" and "Agente siguiente" when Herdr binds them.
- **Session switcher** ([session switcher](../odd/tasks/session-switcher.md)): the computer's name in the header, or a swipe from the left edge, opens a drawer with every paired computer's Herdr workspaces — git branch, tabs with an icon by kind (Pi, Gentle Shell, shell, other agent) and the agent status (⠋ working, red ✗ asking, green ✓ done) — plus an Agentes view grouped by what each agent needs. A search filters workspaces, tabs and branches. Choosing one focuses it in Herdr (the PC's view follows); on another computer the app opens that computer's terminal first. The data comes from `mars-ram herdr list|focus` on each computer.
- **Servers** ([servers list](../odd/tasks/servers-list.md)): with the drawer open, a pill «⌁ N servidores» next to the computer's name lists the servers listening on that computer — port, process, folder, and «toda la red» when it listens beyond the computer. Choosing one opens it inside the app: a WebView fed by an SSH tunnel from the phone's 127.0.0.1 to the computer's loopback (127.0.0.1 or ::1), so nothing is exposed on the tailnet. The viewer can split the screen with the live terminal (⬓ on/off). Ports that do not answer as web, or that listen only on another address, are listed but cannot be opened. The data comes from `mars-ram servers list` on each computer.
- **D-pad:** the four arrow keys around Enter plus Escape and Backspace, to move through menus and option lists. Enter and Backspace live here, not on the key bar. ✥ on the key bar and the always-visible right edge tab toggle it. There is no panel background: keys use translucent raised surfaces and borders, with an accent Enter key.

### R8 · Private links

- The user uploads an image or file from the same sources as R5 and gets a short link to it, served by their own computer.
- The link uses the computer's Tailscale address, so it opens from any device on the user's tailnet, such as the computer's browser, and can be pasted into an agent prompt.
- Links expire one day after they are created.
- Links are hard to guess, expire on their own, and only ever serve the uploaded file, never other files on the computer. Each link serves a copy kept in a folder dedicated to uploads, never an original file or an arbitrary path on disk, so a faulty link can only reach what the user uploaded on purpose. (Moshi gets the same isolation by keeping uploads on its own servers, which C1 rules out for us.)
- The app keeps a history of uploads where the user can copy a link again, see whether it expired, and delete the file.
- Links are created from the Files tab and look like `http://<computer's Tailscale name>:<port>/l/<token>`. Images (PNG, JPEG, GIF, WebP) display in the browser; every other file downloads, so uploaded HTML or scripts never run.
- The link server runs only while the computer has valid links: the app starts it when it creates a link (or reconnects after a reboot), and it exits when the last link expires or is deleted. While the computer is off, its links do not open.
- **Errors:**
  - If the computer is off or unreachable, the link does not open; the app does not present it as available.
  - An expired or deleted link no longer serves the file.

## Success criteria

- [ ] From an Android phone on the user's tailnet, the user connects to their computer, picks a running Pi session, and watches its conversation update live.
- [ ] An instruction sent from the phone appears in the same session on the computer: one conversation, no fork.
- [ ] An instruction sent while the agent is busy is queued as steering and taken by the agent after its current step.
- [ ] A stop requested from the phone stops the agent, and queued messages are not lost.
- [ ] An image sent from the phone reaches the agent, and the agent can describe it (with a model that accepts images).
- [ ] A file and a clipboard image sent from the phone reach the host, and the agent can open them.
- [ ] A link created from the phone opens the uploaded file in the computer's browser, and stops working once it expires or is deleted.
- [ ] After a network drop and reconnect, the user is back in the same session with its completed history.
- [ ] An approval requested by Pi can be answered through the terminal fallback.
- [ ] Text and an attachment written in the terminal composer reach the Pi prompt in the terminal as one message, and Pi's options can be chosen with the D-pad.
- [ ] No server operated by us takes part in any of these flows.

## Risks and open questions

| Topic | Why it matters | How we resolve it |
|-------|----------------|-------------------|
| Host-side bridge | Pi documents no way for an external client to attach to a running session; an extension inside that session is the candidate path. | Proven feasible ([spike](../spikes/pi-bridge/README.md)) |
| Pairing and authorization | The phone must prove it may control the host without a central server. | Design; SSH access plus a bridge token read over SSH worked from a phone ([spike](../spikes/pi-bridge/README.md)) |
| Reconnection | Pi documents recovery of saved history, not replay of live updates. | Proven feasible with limits: the bridge replays missed events, but a reload resets it ([spike](../spikes/pi-bridge/README.md)) |
| Steering from the bridge | Pi documents steering for extensions; the queued and taken states must be observable to show them honestly. | Proven feasible; status is inferred because sends return no ID ([spike](../spikes/pi-bridge/README.md)) |
| Stopping the agent | Moshi stops by sending Escape to the terminal. | Proven feasible: `ctx.abort()` stops the agent from the extension ([spike](../spikes/pi-bridge/README.md)) |
| Images in the chat | Pi messages accept images; models without image input do not. | Proven feasible: native images reach the agent ([spike](../spikes/pi-bridge/README.md)) |
| Detecting "Needs you" | The bridge sees that a dialog is waiting, Gentle's included, but not its question or options (Gentle's dialogs also carry no title). | Proven feasible ([spike](../spikes/pi-bridge/README.md)) |
| Clipboard on Android | Moshi documents its clipboard source for iOS; the Android clipboard limits for images and files must be confirmed. | Feasibility proof |
| Background notices | Opt-in connectedDevice foreground service with an ongoing notice. SSH watch has two-minute idle grace/two-hour no-change limit; passive Tailscale listener requires Tailscale and battery exclusion and cannot detect connection loss. No force-stop/process-death, Doze/OEM or delivery guarantee. | Decided: three modes; preview and closed-test device/battery checks and Play FGS declaration/video pending. No separate Play upload for this feature. |
| Two controllers at once | The user may type on the computer and the phone at the same time. | Design decision |
| Attachment storage | Location, retention, size limit, and screenshots or files that may contain sensitive data. | Decided (2026-10-23): 25 MB per file, removed after 7 days by default; Settings offers 1, 7, or 30 days or never ([attachments](../odd/tasks/attachments.md)). Moved (2026-11-09) from `~/.mars-ram/uploads` to a private per-user temp folder named by `mars-ram uploads-dir` (`/tmp/mars-ram-<uid>/uploads`, `%TEMP%\mars-ram\uploads`); install deletes the old folder ([uploads in tmp](../odd/tasks/uploads-in-tmp.md)) |
| Link exposure | Anyone on the user's tailnet who has a link can open it during its one-day validity, and the computer must keep serving it while links are valid. | Accepted risk, limited by expiry and unguessable links |
| Terminal fallback target | Reaching the exact Pi terminal from the phone likely requires a multiplexer (tmux, Herdr, or both). | Product decision |
| Supported host systems | The MVP supports Linux and native Windows hosts, both tested end to end; WSL counts as Linux; macOS comes later. | Decided (2026-10-19) |
| Product name | Mars-RAM, described as Remote Agent Manager. Every technical identifier uses `mars-ram`; the Android application ID is `com.marssall.marsram`. | Decided (2026-10-22); see [Architecture: Naming](architecture.md#naming) |

## Next steps

Done: the PRD, the feasibility proofs, R1–R6 (Sessions), R5, the host install command, and R7 as terminal first (as of 2026-10-25).

1. R8, private links: built ([private links](../odd/tasks/private-links.md)); the end-to-end check on Linux and Windows is next.
2. Before going public: dependency alerts, release-safe transport for pairing.

## References

Moshi documentation used as reference: [connections](https://getmoshi.app/docs/connections), [terminal sessions](https://getmoshi.app/docs/terminal-sessions), [multiplexers](https://getmoshi.app/docs/multiplexer), [Chat View](https://getmoshi.app/docs/chat-view), [hooks](https://getmoshi.app/docs/hooks), [agents](https://getmoshi.app/docs/agents-usages), [notifications](https://getmoshi.app/docs/notifications), [image paste](https://getmoshi.app/docs/image-paste), [files](https://getmoshi.app/docs/files), [keyboard and shortcuts](https://getmoshi.app/docs/keyboard), [gestures](https://getmoshi.app/docs/gestures), [voice and chat mode](https://getmoshi.app/docs/voice).

Pi behavior referenced: steering with `Enter`, follow-up with `Alt+Enter`, and stop with `Escape`, which returns queued messages to the editor (Pi `docs/usage.md`, `docs/how-pi-works.md`).
