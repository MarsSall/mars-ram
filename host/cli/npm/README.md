# mars-ram @MARS_RAM_VERSION@

The computer side of mars-ram: the command that pairs your phone with this computer, the Pi session bridge and the private-link server. Linux, macOS and Windows; Node.js 24 or newer.

```bash
pnpm add -g mars-ram    # recommended
npm i -g mars-ram       # or
bun add -g mars-ram     # or
```

Then:

```bash
mars-ram install
mars-ram pair
```

`mars-ram install` copies everything to `~/.mars-ram` in your user account (no administrator rights) and installs the bridge into each Pi you choose. `mars-ram doctor` checks the setup, `mars-ram uninstall` removes it (then `pnpm remove -g mars-ram` removes the package). To update: `pnpm add -g mars-ram`, then `mars-ram install`; if you installed earlier with the curl script and `mars-ram install` still runs the old version, run `mars-ram uninstall` first.

The package has no install scripts and no dependencies. It carries the release archive `mars-ram-@MARS_RAM_VERSION@.tar.gz` (SHA-256 `@MARS_RAM_SHA256@`, the same file as the GitHub release) and a launcher that checks that SHA-256, unpacks the archive into a private temporary folder and runs it, because Node does not run TypeScript from `node_modules`. After `mars-ram install`, the launcher runs the installed copy directly when it is this same version.

Install guide: https://marssall.github.io/mars-ram/install

---

**Español.** Instalá con `pnpm add -g mars-ram` (recomendado) o `npm i -g mars-ram`, después ejecutá `mars-ram install` y `mars-ram pair`. Requiere Node.js 24 o más nuevo. Guía: https://marssall.github.io/mars-ram/install
