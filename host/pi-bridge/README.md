# Session bridge

A Pi extension that exposes the live Pi session it is loaded into, so the mobile app can follow and steer that same session over SSH. It never starts a second agent.

## How it works

1. On each session start (startup, reload, new, resume, fork), the bridge creates a new **instance** with a random ID and token.
2. It serves the [protocol](../../packages/protocol/src/index.ts) on `127.0.0.1`, on a random port, behind the instance token.
3. It publishes how to reach it in the **registry**: `~/.<appId>/bridges/<instance>.json`, readable only by the host user. The app reads this file over SFTP and opens an SSH tunnel to the port.
4. On session shutdown it closes the server and removes its registry entry. Entries left by bridges that crashed are pruned when another bridge starts.

`appId` is defined once in [`src/config.ts`](src/config.ts).

## Endpoints

Every request needs `Authorization: Bearer <token>`. Every response carries `protocolVersion`, `bridgeInstanceId`, and `sessionId`.

| Request | Does |
|---------|------|
| `GET /state` | Idle or working, queued messages, pending dialog, model, event numbers, time of the last event, `terminal` availability |
| `GET /terminal` | Visible ANSI screen of this session's own Herdr pane (200); 404 outside Herdr |
| `POST /terminal/input` | `{ "kind": "text", "text": "…", "enter": true, "attachments"?: ["<upload name>"] }` or `{ "kind": "keys", "keys": ["esc", "ctrl+c", "up"] }`; 202 after delivery to Herdr, 404 outside Herdr |
| `POST /terminal/focus` | No body or target; focuses this session's inherited Herdr workspace and tab (200, `status: "focused"`); 404 outside Herdr. Since protocol 1.3 |
| `GET /history` | Messages on the current branch |
| `GET /events?since=N` | Server-sent events: a `replay` header (with `gap: true` if events after `N` were dropped), the events after `N`, then live events |
| `POST /message` | `{ "text", "images": [{ "data", "mimeType" }], "attachments": ["<upload name>"] }`. While the agent is busy the message is queued as steering, like Enter in Pi; the answer says `submitted` or `queued`, and with attachments how many images were attached and why any were withheld (`model`, `blocked`) |
| `POST /abort` | Stops the current run, like Escape in Pi. `requested` is confirmed by an `agent_settled` event with `aborted: true` |

Since terminal first, the app opens Herdr itself over SSH and no longer uses `GET /terminal` or `POST /terminal/input`; they stay for older apps until a major protocol bump. `state.terminal` still tells the app whether the session runs in Herdr. After opening a session's PTY (and each reconnect), the app requests `POST /terminal/focus` once, best-effort. Standalone computer terminals do not request focus; a 404 from an older bridge or any other focus failure is silent and never blocks the terminal.

The terminal adapter is enabled only with a valid inherited `HERDR_PANE_ID`. It uses `HERDR_BIN_PATH` (default `herdr`) and inherits `HERDR_SOCKET_PATH`; execution uses bounded `execFile` calls without a shell on Linux and native Windows. Requests cannot select another pane, command, or file. Focus reads `herdr pane get <inherited pane>` for `result.pane.tab_id`, validates the scoped pane/workspace/tab IDs and that the tab belongs to the same workspace, then runs `herdr workspace focus <workspace>` followed by `herdr tab focus <tab>`. It never accepts a target from the request. Herdr shares focus between clients: opening a session on the phone also moves the PC's view (the user's S11 choice). Malformed metadata or a failed command stops the sequence and returns a generic error without subprocess details. Text is passed literally to Herdr as one argument (Herdr types leading dashes such as `--help` as text). With `enter: true` it goes through one `herdr pane run`, which sends the text as one bracketed paste when the program enabled it, then Enter; without it, `herdr pane send-text` types it raw, so a newline acts as Enter. A failure can still mean some input reached the pane; do not blindly retry.

Attachments (since protocol 1.2) are files the app copied into `~/.mars-ram/uploads` (`PI_BRIDGE_UPLOADS_DIR` overrides it in tests). They are named, never given as paths: up to 10 names of letters, digits, `.`, `_`, and `-`, never `.part` or a Windows device name. The bridge resolves a name inside that folder only and refuses links, hard links, a linked folder, folders, and files over 25 MB; it reads through the handle it checked. Images (PNG, JPEG, GIF, WebP) are attached natively when the model accepts images and Pi's `images.blockImages` is off, up to 50 MB of images per message. Every file's absolute path is appended to the text after "Attached files:", in the chat and in the terminal. A missing or refused upload fails the whole request and names only the upload.

## Known limits

- User and assistant messages are sent whole. Tool output is cut to its first 500 characters.
- Sending returns no message ID, so a message's later status is inferred from events.
- A pending dialog reports its kind and title only; Gentle's dialogs have no title, so the bridge attaches the running tool call that opened them, such as `ask_user_choice` with its question.
- Event numbers are valid only within one instance. After a reload the app must reload history from the new instance.

## Develop

```bash
pnpm test                 # unit tests
pnpm test:contract        # against a disposable Pi session, no model calls
RUN_MODEL_TESTS=1 PI_TEST_MODEL=openai-codex/gpt-6.1-sol pnpm test:contract   # also send, steer, stop, images
pnpm typecheck
```

Try it in a throwaway Pi session:

```bash
pi -e host/pi-bridge/src/extension.ts --no-session
```

Set `PI_BRIDGE_REGISTRY_DIR` to publish the registry somewhere else, for example in tests.

Only interactive terminal sessions are published. Pi sessions in `rpc`, `json` or `print` mode, such as background subagents and one-shot runs, stay off the phone; set `PI_BRIDGE_HEADLESS=1` to publish them anyway, as the contract tests do.

## Layout

| Path | Layer |
|------|-------|
| `src/core/` | Event log, pending dialogs, and operations against the `PiSessionPort` |
| `src/adapters/` | HTTP and SSE server, token, registry, and file permissions per platform |
| `src/extension.ts` | Pi adapter: maps Pi events to the core and implements the port |
| `test/unit/` | Core and adapters with fakes |
| `test/contract/` | The real bridge in a disposable Pi session |
