# Mars-RAM

Your computer's coding-agent sessions, from your Android phone.

Mars-RAM connects to your own computers over SSH on your Tailscale network. It shows your Pi sessions, lets you answer them from a chat or a full terminal (Herdr), dictate on the device, share files through private links that never leave your tailnet, and open guided session shortcuts. There is no account and no cloud service.

- `apps/mobile`: the Android app (Expo, React Native).
- `host/cli`: `mars-ram`, the command you install on your computer (`mars-ram pair`, `install`, `doctor`, `repos`, `launch`, …).
- `host/pi-bridge`: the Pi extension that exposes a live session.
- `host/link-server`: private links on your tailnet.
- `packages/protocol`: the app–bridge protocol.
- `docs/`: architecture, threat model, host CLI and the [privacy policy](docs/privacy.md) ([español](docs/privacy.es.md)).

## Install on your computer

Needs Node.js 24 or newer. With pnpm (recommended) or npm:

```sh
pnpm add -g mars-ram
# or: npm i -g mars-ram
mars-ram install
mars-ram pair
```

Scan the code with the app. On Linux and macOS, `curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh` also works. Requirements, what the installer does and how to read it first: [install guide](docs/install.md) ([español](docs/install.es.md)).

## License

Copyright © 2026 MarsSall. All rights reserved. The source is published for transparency and review; no license is granted to copy, modify or redistribute it.
