# Changelog

Releases of the computer side, the `mars-ram` npm package and GitHub release archive. What changed in the phone app is in its «Novedades» screen (`apps/mobile/src/core/release-notes.ts`).

## mars-ram 0.1.5

Released together with Android build 9 of the app. That app build needs mars-ram 0.1.5 (`MINIMUM_HOST_VERSION`) and asks older computers to update.

Update in the computer's terminal (Linux, macOS or Windows):

```text
pnpm add -g mars-ram@0.1.5
mars-ram install
```

Then type `/reload` in each Pi session that is already running: the session bridge now speaks protocol **1.7**, a compatible minor bump.

### New

- `mars-ram pair-zt [--ssh-port <port>] [--address <ZeroTier ipv4>]` pairs the phone over ZeroTier, as an alternative to Tailscale. It shows a version 2 QR offer; Tailscale offers stay version 1. Over ZeroTier the phone gets sessions, the terminal and files; private links and Siempre atento still need Tailscale.
- On Linux, `pair-zt` and `mars-ram doctor` warn when ufw or firewalld is on and may block ZeroTier, with the exact command to allow the interface. They never run sudo or change the firewall.
- `mars-ram uploads-dir --json` names (and creates) the private per-user folder for phone attachments, `/tmp/mars-ram-<uid>/uploads` on Linux and macOS, `%TEMP%\mars-ram\uploads` on Windows. The system clears it; the app's retention setting still removes older files.

### Fixes

- macOS: finds the Tailscale CLI inside `Tailscale.app` when `tailscale` is not on `PATH`, so `pair`, `doctor` and private links work with the App Store and standalone Tailscale apps. `pair` also says why Tailscale failed: not found, timed out, or its own error.
