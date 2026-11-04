# Spike: bridge to a live Pi session

**Verdict:** feasible, including from an Android phone over Tailscale. A Pi extension loaded into the running TUI can stream the session live, send instructions and images into the same conversation, steer while busy, stop the agent, and report pending dialogs. Two limits shape the design: dialog details are not exposed, and a reload resets the bridge.

This is throwaway feasibility code for the PRD risks in [`docs/prd.md`](../../docs/prd.md), not product code.

## Results

Proofs 1–7 ran on 2026-10-18 with Pi 1.2.0, model `openai-codex/gpt-6.1-sol` (thinking `low`), in an isolated session: empty temporary directory, `-ne` (no user extensions), `--no-session`.

| # | Proof | PRD item | Result | Evidence |
|---|-------|----------|--------|----------|
| 1 | Stream the live session | Host-side bridge, R3 | ✅ Works | Message, tool, and lifecycle events arrived in order over SSE while the TUI ran. |
| 2 | Send into the same conversation | C2, R4 | ✅ Works | A message sent through the bridge appeared in the TUI as a user message and the agent answered it there. |
| 3 | Steer while busy | R4 | ✅ Works | During a 12 s tool call the TUI showed `Steering: …` in its queue, exactly as Enter does. `hasPendingMessages()` was `true` while queued; the steering message appeared as a user `message_start` after the tool result, and the agent answered both. |
| 4 | Native image | R5 | ✅ Works | An image containing `ZORRO-7351`, sent with no file path and with tools forbidden, was read correctly by the agent. |
| 5 | Stop the agent | R4 | ✅ Works | `ctx.abort()` from the extension stopped a `sleep 40` tool call; `agent_settled` reported `aborted: true` 0.1 s later. A message queued before the stop returned to the TUI editor, as Escape does. |
| 6 | Detect "Needs you" | R6 | ⚠️ Works with limits | A `ctx.ui.confirm` dialog fired `ui_prompt_start` (`kind: confirm`, title) and `ui_prompt_end` once answered in the terminal. The question text and options are not exposed. |
| 7 | Reconnect | R3 | ⚠️ Works with limits | Reconnecting with the last seen event number replayed everything missed, including text deltas. Asking for events older than the buffer returns `gap: true`. After `/reload` the bridge restarts with a new port and token and event numbers restart at 1; the session and its history are unchanged. |
| 8 | From the phone over Tailscale | C3 | ✅ Works | From Termux on an Android phone (Samsung S24 Ultra), [`phone-test.sh`](phone-test.sh) read `bridge.json` over SSH, opened an SSH tunnel to the bridge's `127.0.0.1` port across the tailnet, read the state, sent a message, and streamed the reply `HELLO-FROM-PHONE` live. The TUI on the computer showed the same exchange. |
| 9 | Gentle's dialogs | R6 | ⚠️ Works with limits | Run with the user's full Gentle environment, an `ask_user_choice` dialog fired `ui_prompt_start` with `kind: custom` and no title, then `ui_prompt_end` once answered in the terminal; the agent received the choice. |

## What this means for the design

- **The extension is the integration point.** No SDK or RPC attach is needed, and the user's TUI stays the owner of the session (C2).
- **Message status must be inferred.** `sendUserMessage()` returns nothing, so the bridge cannot hand back an ID. "Taken" is detected when the agent starts the matching user message; "returned to the editor" is inferred when a queued message was never taken and the run ended aborted.
- **Gentle's dialogs are detectable but anonymous.** They draw their own component, so `ui_prompt_start` carries `kind: custom` and no title. The tool call that opened the dialog (for example `ask_user_choice`) is visible just before it, and its arguments hold the question and options; the spike does not forward those arguments yet.
- **"Needs you" is a status, not an answerable request.** The phone can show that a dialog of a given kind and title is waiting, then send the user to the terminal fallback (R7). Answering from the chat would need the dialog's content, which Pi does not expose to other extensions.
- **The bridge needs an instance identity.** A reload (and any restart) resets the in-memory event buffer. The protocol must tell the phone when the bridge instance changed so it reloads from the durable history instead of trusting old event numbers.
- **Discovery must survive a reload.** The port and token change on reload, so the phone has to re-read how to reach the bridge, which in the product happens over SSH.

## Not covered

- Several Pi sessions on one host, and two controllers typing at once.
- The Android app itself, clipboard, links, and the terminal fallback.

## Notes from the Gentle run

- Launched with `gentle-shell -- -e bridge.ts --no-session --thinking low`, which loads the user's full Gentle environment (`ask-user-choice.ts`, `ask-user-question.ts`, Engram, and others) next to the bridge.
- Engram registered one session for the temporary directory (project `work`) with no observations or prompts.

## Notes from the phone run

- Discovery over SSH works as designed: the phone needs only SSH access; port and token never have to be typed.
- The first SSH attempt failed with `Could not resolve hostname devbox` and the retry succeeded. MagicDNS resolution on the phone can fail briefly, so the app should retry or fall back to the Tailscale IP.
- Termux's `curl` failed with `CANNOT LINK EXECUTABLE` after a partial package upgrade; upgrading `libngtcp2` fixed it. This is a test-environment issue, not a bridge one.

## Run it

Requires Pi and `tmux`. Each run uses a few model calls.

```bash
S=$(mktemp -d); mkdir -p "$S/work" "$S/state"; cd "$S/work"
PI_BRIDGE_DIR="$S/state" pi -ne -e /path/to/spikes/pi-bridge/bridge.ts --no-session --thinking low
```

In another terminal, the client plays the phone:

```bash
C="node spikes/pi-bridge/client.mjs $S/state"
$C events 0 300 &                     # stream events; replay from event 0
$C send "Reply with exactly: OK"      # steers automatically while the agent is busy
$C image photo.png "What is in this image?"
$C state                              # idle, queue, pending dialog, model input types
$C abort
$C history
```

## How it works

- [`bridge.ts`](bridge.ts) starts an HTTP server on `127.0.0.1` at `session_start`, on a random port, and writes the port and a random bearer token to `bridge.json` with mode `0600`. It closes the server at `session_shutdown`.
- Events go into a ring buffer of 1000 entries with increasing numbers, streamed with server-sent events; `?since=N` replays newer ones.
- `POST /message` calls `pi.sendUserMessage()` with text and image blocks, using `deliverAs: "steer"` when the agent is busy. `POST /abort` calls `ctx.abort()`.
- [`client.mjs`](client.mjs) is a small command-line client for the endpoints above.
