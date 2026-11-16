# Changelog

Releases of the computer side, the `mars-ram` npm package and GitHub release archive. What changed in the phone app is in its «Novedades» screen (`apps/mobile/src/core/release-notes.ts`).

## mars-ram 0.1.7

Released together with Android build 11 of the app. Build 11 still works with mars-ram 0.1.6 (`MINIMUM_HOST_VERSION` stays 0.1.6), but only build 11 or later can scan the compact QR that 0.1.7 prints: update the app before or together with the computer.

Update in the computer's terminal (Linux, macOS or Windows), from 0.1.6 or older:

```text
pnpm add -g mars-ram@0.1.7
mars-ram install
```

From 0.1.7 on, `mars-ram update` does it. The session bridge still speaks protocol **1.7**, so Pi sessions that are already running need no `/reload`.

### New

- `mars-ram update` updates the computer side in one command: it updates the package with the package manager mars-ram was installed with (pnpm, npm or Bun) and runs `mars-ram install` of the new version, reporting the version it went from and to. It explains the usual failures instead of the raw error: pnpm's global bin directory not in PATH (`pnpm setup`, then a new terminal), the package manager not found; an administrator terminal on Windows is refused, and on Windows the update continues in a new window so the running `mars-ram.cmd` is never replaced under cmd.exe. Installations from the curl or PowerShell script or a clone get the way to update them instead. The app's update notice shows `mars-ram update` for computers with 0.1.7 or later.
- `mars-ram pair` finds the connected network on its own: Tailscale or ZeroTier. When both are connected it asks in the terminal which one the phone uses; `--network tailscale|zerotier` chooses without asking. `mars-ram pair-zt` still works and means `pair --network zerotier`. The QR offers do not change.
- `mars-ram pair` prints a much smaller QR: a compact version 3 offer carries the same information (address, MagicDNS name, SSH user and port, the full host key fingerprint and the full one-time code, expiry) as bytes instead of JSON. A typical Tailscale QR goes from 65×65 to 45×45 modules (69 columns × 35 lines to 49 × 25 in the terminal); a ZeroTier one to 41×41. The link keeps its `mars-ram://pair?p=…` form, so the phone's camera still opens the app. **Rollout:** only an app build that reads version 3 can pair with it; an older app shows its invalid-code message («Este QR no es un código de vinculación válido para esta app. Mostrá uno nuevo en la computadora o actualizá la app.»), so release that app build before or with this host.

## mars-ram 0.1.6

Released together with Android build 10 of the app. That app build needs mars-ram 0.1.6 (`MINIMUM_HOST_VERSION`) and asks older computers to update.

Update in the computer's terminal (Linux, macOS or Windows):

```text
pnpm add -g mars-ram@0.1.6
mars-ram install
```

The session bridge still speaks protocol **1.7**, so Pi sessions that are already running need no `/reload`.

### New

- Private links and Siempre atento work over ZeroTier. The link commands take `--network zerotier --address <ipv4>` (the ZeroTier address the phone paired with); the link server then runs a separate listener bound only to that ZeroTier address, on the same port 47811, next to the Tailscale one. `mars-ram notify register` accepts a phone that connects over ZeroTier from inside that ZeroTier subnet, and `mars-ram doctor` warns per network, Tailscale and ZeroTier.
- Limitation: a computer paired with the same phone over both Tailscale and ZeroTier keeps one Siempre atento registration, the last one, so its notices go over that network.

### Fixes

- Security: the project browser refuses hard links in `file`, `diff` and `stage-link`, and a working-tree diff takes only a single file, never a folder. Reported in MarsSall/mars-ram#1.

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
