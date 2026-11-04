# Mars-RAM

Your computer's coding-agent sessions, from your Android phone.

Mars-RAM connects to your own computers over SSH on your Tailscale network. It shows your Pi sessions, lets you answer them from a chat or a full terminal (Herdr), dictate on the device, share files through private links that never leave your tailnet, and open guided session shortcuts. There is no account and no cloud service.

- `apps/mobile`: the Android app (Expo, React Native).
- `host/cli`: `mars-ram`, the command you install on your computer (`mars-ram pair`, `install`, `doctor`, `repos`, `launch`, …).
- `host/pi-bridge`: the Pi extension that exposes a live session.
- `host/link-server`: private links on your tailnet.
- `packages/protocol`: the app–bridge protocol.
- `docs/`: architecture, threat model, host CLI and the [privacy policy](docs/privacy.md) ([español](docs/privacy.es.md)).

## License

Copyright © 2026 MarsSall. All rights reserved. The source is published for transparency and review; no license is granted to copy, modify or redistribute it.
