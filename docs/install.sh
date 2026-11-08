#!/bin/sh
# mars-ram installer for Linux and macOS (computer side: CLI, Pi bridge, link server).
#
# What it does, in order, all inside your user account (no sudo):
#   1. Checks Node.js 24+, tar, curl or wget, and sha256sum or shasum; stops before downloading if one is missing.
#      Warns (and continues) if pi, tailscale or an SSH server are not found; `mars-ram doctor` checks everything later.
#   2. Downloads the release archive of the version written below into a temporary folder.
#   3. Verifies its SHA-256 against the value written below; on a mismatch it deletes the download and installs nothing.
#   4. Unpacks it and runs `mars-ram install`, which asks you which Pi environments to use and for confirmation.
#   5. Removes the temporary folder. Next step: `mars-ram pair`.
#
# Read it before running it:
#   curl -fsSL https://marssall.github.io/mars-ram/install.sh -o install.sh
#   less install.sh
#   sh install.sh
#
# MARS_RAM_DOWNLOAD_URL replaces the archive URL (a mirror or a local file:// copy). The checksum below is still
# enforced, so it can never install different bytes. Each script installs exactly the version it names.
# MARS_RAM_INPUT reads the install answers from a file instead of /dev/tty (used by the tests).

main() {
 set -eu
 version='0.1.4'
 sha256='0dea49aa4f621333c04280d6b25bce57668a74086ca42ac2e8bda2313513ed3d'
 url=${MARS_RAM_DOWNLOAD_URL:-"https://github.com/MarsSall/mars-ram/releases/download/v$version/mars-ram-$version.tar.gz"}
 page='https://marssall.github.io/mars-ram/install.sh'

 case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in es*|ES*) es=1 ;; *) es=0 ;; esac

 case "$sha256" in
  *[!0-9a-f]*) fail 'Este instalador está incompleto (sin suma de verificación). Descargalo de nuevo.' 'This installer is incomplete (no checksum). Download it again.' ;;
 esac
 [ ${#sha256} -eq 64 ] || fail 'Este instalador está incompleto (sin suma de verificación). Descargalo de nuevo.' 'This installer is incomplete (no checksum). Download it again.'

 # Hard requirements: report every missing one, then stop before downloading anything.
 missing=0
 node_version=''
 if command -v node >/dev/null 2>&1; then node_version=$(node -p process.versions.node 2>/dev/null) || node_version=''; fi
 node_major=${node_version%%.*}
 case "$node_major" in
  ''|*[!0-9]*)
   say_err 'mars-ram necesita Node.js 24 o más nuevo y no se encontró node. Instalalo desde https://nodejs.org y volvé a ejecutar esto.' \
    'mars-ram needs Node.js 24 or newer and node was not found. Install it from https://nodejs.org and run this again.'
   missing=1 ;;
  *)
   if [ "$node_major" -lt 24 ]; then
    say_err "mars-ram necesita Node.js 24 o más nuevo; esta computadora tiene $node_version. Actualizalo desde https://nodejs.org y volvé a ejecutar esto." \
     "mars-ram needs Node.js 24 or newer; this computer has $node_version. Update it from https://nodejs.org and run this again."
    missing=1
   fi ;;
 esac
 if ! command -v tar >/dev/null 2>&1; then
  say_err 'mars-ram necesita tar para descomprimir la descarga y no se encontró. Instalalo y volvé a ejecutar esto.' \
   'mars-ram needs tar to unpack the download and it was not found. Install it and run this again.'
  missing=1
 fi
 if command -v curl >/dev/null 2>&1; then downloader=curl
 elif command -v wget >/dev/null 2>&1; then downloader=wget
 else
  say_err 'mars-ram necesita curl o wget para descargar y no se encontró ninguno. Instalá uno y volvé a ejecutar esto.' \
   'mars-ram needs curl or wget to download and neither was found. Install one and run this again.'
  missing=1
 fi
 if command -v sha256sum >/dev/null 2>&1; then hasher=sha256sum
 elif command -v shasum >/dev/null 2>&1; then hasher=shasum
 else
  say_err 'mars-ram necesita sha256sum o shasum para verificar la descarga y no se encontró ninguno. Instalá uno y volvé a ejecutar esto.' \
   'mars-ram needs sha256sum or shasum to verify the download and neither was found. Install one and run this again.'
  missing=1
 fi
 [ "$missing" -eq 0 ] || exit 1

 # Questions come from the terminal even when this script arrives through a pipe.
 if [ -n "${MARS_RAM_INPUT:-}" ]; then input=$MARS_RAM_INPUT
 elif (: </dev/tty) 2>/dev/null; then input=/dev/tty
 else
  say_err "Este instalador hace preguntas y necesita una terminal. Descargalo y ejecutalo en una terminal:
  curl -fsSL $page -o install.sh
  sh install.sh" "This installer asks questions and needs a terminal. Download it and run it in a terminal:
  curl -fsSL $page -o install.sh
  sh install.sh"
  exit 1
 fi

 # Soft checks: warn and continue.
 if ! command -v pi >/dev/null 2>&1; then
  say_err 'Aviso: no se encontró pi. mars-ram funciona con Pi: instalalo desde https://pi.dev y después ejecutá mars-ram install de nuevo.' \
   'Warning: pi was not found. mars-ram works with Pi: install it from https://pi.dev, then run mars-ram install again.'
 fi
 if ! command -v tailscale >/dev/null 2>&1; then
  say_err 'Aviso: no se encontró tailscale. El teléfono llega a esta computadora por Tailscale: https://tailscale.com/download' \
   'Warning: tailscale was not found. The phone reaches this computer through Tailscale: https://tailscale.com/download'
 fi
 if [ "$(uname -s)" = Darwin ]; then
  say 'El teléfono se conecta por SSH: activá Sesión remota (Remote Login) en Ajustes del Sistema > General > Compartir.' \
   'The phone connects over SSH: turn on Remote Login in System Settings > General > Sharing.'
 elif ! command -v sshd >/dev/null 2>&1 && [ ! -x /usr/sbin/sshd ] && [ ! -x /usr/local/sbin/sshd ]; then
  say_err 'Aviso: no se encontró un servidor SSH (sshd). El teléfono se conecta por SSH: instalá OpenSSH server (por ejemplo, el paquete openssh-server).' \
   'Warning: no SSH server (sshd) was found. The phone connects over SSH: install OpenSSH server (for example, the openssh-server package).'
 fi
 say 'Después de instalar, mars-ram doctor revisa todo.' 'After installing, mars-ram doctor checks everything.'

 tmp=$(mktemp -d "${TMPDIR:-/tmp}/mars-ram-install.XXXXXX")
 trap 'rm -rf "$tmp"' EXIT
 trap 'exit 130' INT
 trap 'exit 143' TERM
 archive="$tmp/mars-ram-$version.tar.gz"

 say "Descargando mars-ram $version…" "Downloading mars-ram $version…"
 if [ "$downloader" = curl ]; then fetched=0; curl -fsSL -o "$archive" "$url" || fetched=$?
 else fetched=0; wget -q -O "$archive" "$url" || fetched=$?
 fi
 if [ "$fetched" -ne 0 ]; then
  say_err "No se pudo descargar $url. No se instaló nada." "Could not download $url. Nothing was installed."
  exit 1
 fi

 if [ "$hasher" = sha256sum ]; then sum=$(sha256sum "$archive"); else sum=$(shasum -a 256 "$archive"); fi
 actual=${sum%% *}
 if [ "$actual" != "$sha256" ]; then
  rm -f "$archive"
  say_err "La descarga no coincide con la suma de verificación esperada. No se instaló nada.
  esperada: $sha256
  obtenida: $actual
Volvé a intentarlo más tarde; si se repite, no lo instales y avisanos." "The download does not match the expected checksum. Nothing was installed.
  expected: $sha256
  actual:   $actual
Try again later; if it happens again, do not install it and let us know."
  exit 1
 fi

 tar -xzf "$archive" -C "$tmp"
 main_ts="$tmp/mars-ram-$version/cli/src/main.ts"
 if [ ! -f "$main_ts" ]; then
  say_err 'La descarga no tiene el contenido esperado. No se instaló nada.' 'The download does not have the expected content. Nothing was installed.'
  exit 1
 fi

 status=0
 node --disable-warning=ExperimentalWarning "$main_ts" install <"$input" || status=$?
 if [ "$status" -ne 0 ]; then exit "$status"; fi
 # install also exits 0 when the person cancels: only point to pair when the command exists.
 if [ -e "$HOME/.local/bin/mars-ram" ]; then say 'Ahora ejecutá: mars-ram pair' 'Now run: mars-ram pair'
 else say 'No se instaló mars-ram. Ejecutá este comando de nuevo cuando quieras.' 'mars-ram was not installed. Run this command again when you are ready.'; fi
}

say() { if [ "$es" -eq 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
say_err() { say "$1" "$2" >&2; }
fail() { say_err "$1" "$2"; exit 1; }

main "$@"
