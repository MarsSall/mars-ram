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

Scan the code with the app.

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

- **"mars-ram: command not found"**: open a new terminal. With pnpm, run `pnpm setup` once if it says the global bin directory is not set. On Linux and macOS with the script, add `~/.local/bin` to your PATH if it said so.
- **Node.js is too old**: install Node.js 24 or newer and run the add command again.
- **Windows says the terminal is running as administrator**: open a normal terminal and run the command again.
- **The download does not match the checksum**: do not install. Try again later and tell us if it repeats.
