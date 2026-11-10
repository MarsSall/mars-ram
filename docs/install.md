# Install mars-ram on your computer

Mars-RAM on your phone talks to `mars-ram` on your computer. Install it once with one command, then pair your phone.

## Before you start

| You need | Why |
| --- | --- |
| [Node.js](https://nodejs.org) 24 or newer | runs mars-ram |
| [Pi](https://pi.dev) | the sessions you see on the phone |
| [Tailscale](https://tailscale.com) on the computer and the phone | the private network between them |
| An SSH server | Linux: OpenSSH (`sshd`). macOS: System Settings › General › Sharing › Remote Login. Windows: the OpenSSH Server optional feature |

`mars-ram doctor` checks all of them after installing.

## Install

In a terminal, the same on Linux, macOS and Windows:

```sh
pnpm add -g mars-ram
```

That is the recommended way. With npm or Bun instead:

```sh
npm i -g mars-ram
```

```sh
bun add -g mars-ram
```

If pnpm says the global bin directory is not set, run `pnpm setup` once, open a new terminal and run the command again.

Then set it up for your user:

```sh
mars-ram install
```

It installs for your user only, with no administrator rights. It asks which Pi environments to include and for a confirmation. On Windows, use a normal terminal (not "Run as administrator").

**Linux or macOS without pnpm or npm:** this script does the same in one line:

```sh
curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh
```

On Windows, use pnpm or npm.

## Then pair your phone

Open a new terminal and run:

```sh
mars-ram pair
```

Scan the code with the app. On Windows, if your user is an administrator, run `mars-ram pair` in an administrator terminal: the computer asks you there to authorize the phone.

Using ZeroTier instead of Tailscale? Join the computer to your ZeroTier network, authorize it in ZeroTier Central, and run `mars-ram pair-zt`; if the computer is in several ZeroTier networks, it lists their addresses and you pick one with `--address <ipv4>`. This needs an app version that supports ZeroTier. Over ZeroTier you get SSH sessions, the terminal and files; private links and Siempre atento still need Tailscale. On Linux, a firewall (ufw or firewalld) blocks ZeroTier until you let it in: when one is on, `mars-ram pair-zt` and `mars-ram doctor` print the exact command with the interface name, such as `sudo ufw allow in on <ZeroTier interface> comment 'ZeroTier'` (Tailscale does not need this).

In the app, **Add computer** first asks which network you use, Tailscale (recommended) or ZeroTier, and remembers it; you can change it on the first step. It then walks you through it step by step: it checks Tailscale and Private DNS on the phone (or, for ZeroTier, that the ZeroTier app is installed and on; Android runs one VPN at a time) and moves on by itself once they are right, shows these commands for Linux, macOS or Windows with copy buttons, and, if the scan fails or stalls, **See what's wrong** names the likely cause and its fix. **I know, scan** jumps straight to the camera; **Add manually** stays available from the scan step.

## What the installer does

1. `pnpm add -g mars-ram` (or npm, or Bun) puts the `mars-ram` package from the npm registry in your package manager's global folder. The package runs no install scripts; it carries one fixed version of mars-ram and checks its SHA-256 before unpacking it.
2. `mars-ram install` copies mars-ram to `~/.mars-ram` and connects the Pi bridge. The package's `mars-ram` stays your command; if an earlier install with the script left its own `mars-ram` command, it removes it (only that one, never a file it did not create).

The `curl … | sh` script adds its own `mars-ram` command (`~/.local/bin/mars-ram`). It checks the requirements, downloads one fixed version from the [releases of MarsSall/mars-ram](https://github.com/MarsSall/mars-ram/releases), checks its SHA-256 against the value written inside the script (if they differ, it deletes the download and installs nothing) and runs `mars-ram install`.

## Read it before you run it

The npm package, on Linux, macOS and Windows (Windows 10 and later include `tar`). Download it without installing it; `npm pack` prints the exact file name, for example `mars-ram-0.1.2.tgz`:

```sh
npm pack mars-ram
```

Extract that exact file, using the name it printed:

```sh
tar -xzf mars-ram-0.1.2.tgz
```

Open `package/bin/mars-ram.mjs` (the program that runs) and `package/README.md` with any editor; on Windows, Notepad works. The source is public: the launcher is [`host/cli/npm/mars-ram.mjs`](https://github.com/MarsSall/mars-ram/blob/main/host/cli/npm/mars-ram.mjs) in [MarsSall/mars-ram](https://github.com/MarsSall/mars-ram), and `package/archive/` holds the same file as the GitHub release.

The script:

```sh
curl -fsSL https://marssall.github.io/mars-ram/install.sh -o install.sh
less install.sh
sh install.sh
```

## Later

- `mars-ram doctor` checks the whole setup and says what to fix.
- To update, run `pnpm add -g mars-ram` (or `npm i -g mars-ram`, or `bun add -g mars-ram`), then `mars-ram install`. If you installed earlier with the `curl` script and `mars-ram install` still runs the old version, run `mars-ram uninstall` first, then `mars-ram install`. With the script only, run the `curl` command again.
- `mars-ram uninstall` removes what `mars-ram install` added; the package stays. Then remove it with `pnpm remove -g mars-ram`, `npm uninstall -g mars-ram` or `bun remove -g mars-ram`.

## If something goes wrong

- **pnpm says `No matching version found for mars-ram@latest`** right after a new release: your pnpm configuration has a `minimumReleaseAge` rule that skips versions younger than a few days. Exempt mars-ram in `~/.config/pnpm/config.yaml` with `minimumReleaseAgeExclude:` and, if you also use `trustPolicy: no-downgrade`, `trustPolicyExclude:`, each a list with `- mars-ram`, wait a few days, or install with `npm i -g mars-ram`.
- **"mars-ram: command not found"**: open a new terminal. With pnpm, run `pnpm setup` once if it says the global bin directory is not set. On Linux and macOS with the script, add `~/.local/bin` to your PATH if it said so.
- **Node.js is too old**: install Node.js 24 or newer and run the add command again.
- **Windows says the terminal is running as administrator**: open a normal terminal and run the command again.
- **Pairing says the phone can't find the computer by its Tailscale name**: Android's Private DNS bypasses Tailscale's MagicDNS. Turn it off on the phone (Settings › Connections › More connection settings › Private DNS › Off) and scan a new code.
- **The download does not match the checksum**: do not install. Try again later and tell us if it repeats.
