# Install mars-ram on your computer

Mars-RAM on your phone talks to `mars-ram` on your computer. Install it once with one command, then pair your phone.

## Before you start

| You need | Why |
| --- | --- |
| [Node.js](https://nodejs.org) 24 or newer | runs mars-ram |
| [Pi](https://pi.dev) | the sessions you see on the phone |
| [Tailscale](https://tailscale.com) on the computer and the phone | the private network between them |
| An SSH server | Linux: OpenSSH (`sshd`). macOS: System Settings › General › Sharing › Remote Login. Windows: the OpenSSH Server optional feature |

The installer stops before downloading anything if Node.js is missing, and warns about the rest.

## Install

**Linux or macOS**, in a terminal:

```sh
curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh
```

**Windows**, in a normal PowerShell window (not "Run as administrator"):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://marssall.github.io/mars-ram/install.ps1 | iex"
```

It installs for your user only, with no administrator rights. It asks which Pi environments to include and for a confirmation.

## Then pair your phone

Open a new terminal and run:

```sh
mars-ram pair
```

Scan the code with the app.

## What the installer does

1. Checks the requirements.
2. Downloads one fixed version of mars-ram from the [releases of MarsSall/mars-ram](https://github.com/MarsSall/mars-ram/releases).
3. Checks its SHA-256 against the value written inside the installer. If they differ, it deletes the download and installs nothing.
4. Runs `mars-ram install`, which copies mars-ram to `~/.mars-ram`, adds the `mars-ram` command and connects the Pi bridge.

## Read it before you run it

```sh
curl -fsSL https://marssall.github.io/mars-ram/install.sh -o install.sh
less install.sh
sh install.sh
```

```powershell
irm https://marssall.github.io/mars-ram/install.ps1 -OutFile install.ps1
notepad install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

## Later

- `mars-ram doctor` checks the whole setup and says what to fix.
- Run the install command again to update.
- `mars-ram uninstall` removes what the installer added.

## If something goes wrong

- **"mars-ram: command not found"**: open a new terminal. On Linux and macOS, add `~/.local/bin` to your PATH if the installer said so.
- **Windows says the window is running as administrator**: open PowerShell normally and run the command again.
- **The download does not match the checksum**: do not install. Try again later and tell us if it repeats.
