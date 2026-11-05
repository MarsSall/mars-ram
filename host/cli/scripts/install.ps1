# mars-ram installer for Windows (computer side: CLI, Pi bridge, link server).
#
#   powershell -ExecutionPolicy Bypass -c "irm https://marssall.github.io/mars-ram/install.ps1 | iex"
#
# What it does, in order, all inside your user account (no administrator rights):
#   1. Refuses an elevated (administrator) session: open a normal PowerShell window instead.
#   2. Checks Node.js 24+ and tar.exe (Windows 10 1803 or newer); stops before downloading if one is missing.
#      Warns (and continues) if pi, tailscale or the OpenSSH Server service (sshd) are not found or not running;
#      `mars-ram doctor` checks everything later.
#   3. Downloads the release archive of the version written below into a new folder under %TEMP%.
#   4. Verifies its SHA-256 against the value written below; on a mismatch it deletes the download and installs nothing.
#   5. Unpacks it with tar.exe and runs `mars-ram install` in this console; it asks which Pi environments to use and for
#      confirmation. Then removes the temporary folder. Next step, in a new terminal: `mars-ram pair`.
#
# Read it before running it:
#   irm https://marssall.github.io/mars-ram/install.ps1 -OutFile install.ps1
#   notepad install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# MARS_RAM_DOWNLOAD_URL replaces the archive URL (a mirror, a file:// URL or a local path). The checksum below is still
# enforced, so it can never install different bytes. Each script installs exactly the version it names.
# Works in Windows PowerShell 5.1 and PowerShell 7. It never closes your console: on failure it prints why and sets
# $LASTEXITCODE. This file is plain ASCII; Spanish accents are written as {a} {e} {i} {o} {u} {n}.

function Install-MarsRam {
 $ErrorActionPreference = 'Stop'
 $ProgressPreference = 'SilentlyContinue'
 $version = '@MARS_RAM_VERSION@'
 $sha256 = '@MARS_RAM_SHA256@'
 $url = "https://github.com/MarsSall/mars-ram/releases/download/v$version/mars-ram-$version.tar.gz"
 if ($env:MARS_RAM_DOWNLOAD_URL) { $url = $env:MARS_RAM_DOWNLOAD_URL }
 $es = (Get-Culture).TwoLetterISOLanguageName -eq 'es'

 function Text([string]$spanish, [string]$english) {
  if (-not $es) { return $english }
  $accents = @{ '{a}' = [char]0xE1; '{e}' = [char]0xE9; '{i}' = [char]0xED; '{o}' = [char]0xF3; '{u}' = [char]0xFA; '{n}' = [char]0xF1 }
  foreach ($token in $accents.Keys) { $spanish = $spanish.Replace($token, [string]$accents[$token]) }
  return $spanish
 }
 function Say([string]$spanish, [string]$english) { Write-Host (Text $spanish $english) }
 function Warn([string]$spanish, [string]$english) { Write-Host (Text $spanish $english) -ForegroundColor Yellow }
 # Every refusal goes through here; native commands also set $LASTEXITCODE, so it is set last.
 function Problem([string]$spanish, [string]$english) { Write-Host (Text $spanish $english) -ForegroundColor Red; $global:LASTEXITCODE = 1 }
 # Same rule as `mars-ram install`: high or system integrity level means elevated. SIDs, because names are localized.
 function Test-Elevated {
  try { $groups = (& whoami.exe /groups /fo csv) -join "`n" } catch { $groups = '' }
  if ($groups) { return ($groups -match '"S-1-16-12288"' -or $groups -match '"S-1-16-16384"') }
  $principal = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 }

 if ($sha256 -cnotmatch '^[0-9a-f]{64}$') {
  Problem 'Este instalador est{a} incompleto (sin suma de verificaci{o}n). Descargalo de nuevo.' 'This installer is incomplete (no checksum). Download it again.'
  return
 }
 if (Test-Elevated) {
  Problem 'Esta ventana de PowerShell se abri{o} como administrador. mars-ram se instala en tu usuario, sin privilegios: abr{i} una ventana de PowerShell normal (sin "Ejecutar como administrador") y volv{e} a ejecutar el comando. No se instal{o} nada.' `
   'This PowerShell window was opened as administrator. mars-ram installs into your user account, without privileges: open a normal PowerShell window (not "Run as administrator") and run the command again. Nothing was installed.'
  return
 }

 # Hard requirements: report every missing one, then stop before downloading anything.
 $missing = $false
 $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
 $nodeVersion = ''
 if ($node) { try { $nodeVersion = [string](& $node.Source -p 'process.versions.node') } catch { $nodeVersion = '' } }
 $nodeMajor = 0
 if (-not $node -or -not [int]::TryParse(($nodeVersion -split '\.')[0], [ref]$nodeMajor)) {
  Problem 'mars-ram necesita Node.js 24 o m{a}s nuevo y no se encontr{o} node. Instalalo desde https://nodejs.org y volv{e} a ejecutar esto.' `
   'mars-ram needs Node.js 24 or newer and node was not found. Install it from https://nodejs.org and run this again.'
  $missing = $true
 } elseif ($nodeMajor -lt 24) {
  Problem "mars-ram necesita Node.js 24 o m{a}s nuevo; esta computadora tiene $nodeVersion. Actualizalo desde https://nodejs.org y volv{e} a ejecutar esto." `
   "mars-ram needs Node.js 24 or newer; this computer has $nodeVersion. Update it from https://nodejs.org and run this again."
  $missing = $true
 }
 $tar = Get-Command tar.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
 if (-not $tar) {
  Problem 'mars-ram necesita tar.exe para descomprimir la descarga y no se encontr{o}. Viene con Windows 10 (versi{o}n 1803) o m{a}s nuevo; actualiz{a} Windows y volv{e} a ejecutar esto.' `
   'mars-ram needs tar.exe to unpack the download and it was not found. It ships with Windows 10 (version 1803) or newer; update Windows and run this again.'
  $missing = $true
 }
 if ($missing) { return }

 # Soft checks: warn and continue.
 if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
  Warn 'Aviso: no se encontr{o} pi. mars-ram funciona con Pi: instalalo desde https://pi.dev y despu{e}s ejecut{a} mars-ram install de nuevo.' `
   'Warning: pi was not found. mars-ram works with Pi: install it from https://pi.dev, then run mars-ram install again.'
 }
 if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  Warn 'Aviso: no se encontr{o} tailscale. El tel{e}fono llega a esta computadora por Tailscale: https://tailscale.com/download' `
   'Warning: tailscale was not found. The phone reaches this computer through Tailscale: https://tailscale.com/download'
 }
 $sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
 if (-not $sshd) {
  Warn 'Aviso: no est{a} instalado el servidor OpenSSH (servicio sshd). El tel{e}fono se conecta por SSH: agregalo en Configuraci{o}n > Sistema > Caracter{i}sticas opcionales > Servidor OpenSSH.' `
   'Warning: OpenSSH Server (service sshd) is not installed. The phone connects over SSH: add it in Settings > System > Optional features > OpenSSH Server.'
 } elseif ($sshd.Status -ne 'Running') {
  Warn 'Aviso: el servicio OpenSSH Server (sshd) no est{a} en ejecuci{o}n. El tel{e}fono se conecta por SSH: inicialo desde Servicios (services.msc) como administrador.' `
   'Warning: the OpenSSH Server service (sshd) is not running. The phone connects over SSH: start it from Services (services.msc) as administrator.'
 }
 Say 'Despu{e}s de instalar, mars-ram doctor revisa todo.' 'After installing, mars-ram doctor checks everything.'

 $tmp = Join-Path $env:TEMP ('mars-ram-install-' + [guid]::NewGuid().ToString('N'))
 $protocols = [Net.ServicePointManager]::SecurityProtocol
 try {
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $archive = Join-Path $tmp "mars-ram-$version.tar.gz"

  Say "Descargando mars-ram $version..." "Downloading mars-ram $version..."
  try {
   $uri = $null
   if ([uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri) -and -not $uri.IsFile) {
    # Windows PowerShell 5.1 may not offer TLS 1.2 by default.
    [Net.ServicePointManager]::SecurityProtocol = $protocols -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $archive
   } else {
    $source = $url
    if ($uri) { $source = $uri.LocalPath }
    Copy-Item -LiteralPath $source -Destination $archive
   }
  } catch {
   Problem "No se pudo descargar $url. No se instal{o} nada." "Could not download $url. Nothing was installed."
   return
  }

  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $sha256) {
   Remove-Item -LiteralPath $archive -Force
   Problem "La descarga no coincide con la suma de verificaci{o}n esperada. No se instal{o} nada.`n  esperada: $sha256`n  obtenida: $actual`nVolv{e} a intentarlo m{a}s tarde; si se repite, no lo instales y avisanos." `
    "The download does not match the expected checksum. Nothing was installed.`n  expected: $sha256`n  actual:   $actual`nTry again later; if it happens again, do not install it and let us know."
   return
  }

  & $tar.Source -xzf $archive -C $tmp
  $mainTs = Join-Path $tmp "mars-ram-$version\cli\src\main.ts"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $mainTs -PathType Leaf)) {
   Problem 'La descarga no tiene el contenido esperado. No se instal{o} nada.' 'The download does not have the expected content. Nothing was installed.'
   return
  }

  # Questions come from this console: native programs inherit it, also through irm | iex.
  & $node.Source --disable-warning=ExperimentalWarning $mainTs install
  $status = $LASTEXITCODE
  $global:LASTEXITCODE = $status
  if ($status -ne 0) { return }
  # install also exits 0 when the person cancels: only point to pair when the command exists.
  if (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.mars-ram\bin\mars-ram.cmd') -PathType Leaf) {
   Say 'Ahora abr{i} una terminal nueva y ejecut{a}: mars-ram pair' 'Now open a new terminal and run: mars-ram pair'
  } else {
   Say 'No se instal{o} mars-ram. Ejecut{a} este comando de nuevo cuando quieras.' 'mars-ram was not installed. Run this command again when you are ready.'
  }
 } finally {
  [Net.ServicePointManager]::SecurityProtocol = $protocols
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
 }
}

Install-MarsRam
