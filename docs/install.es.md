# Instalá mars-ram en tu computadora

Mars-RAM en tu teléfono habla con `mars-ram` en tu computadora. Instalalo una vez con un comando y después vinculá tu teléfono.

## Antes de empezar

| Necesitás | Para qué |
| --- | --- |
| [Node.js](https://nodejs.org) 24 o más nuevo | ejecuta mars-ram |
| [Pi](https://pi.dev) | las sesiones que ves en el teléfono |
| [Tailscale](https://tailscale.com) en la computadora y en el teléfono | la red privada entre los dos |
| Un servidor SSH | Linux: OpenSSH (`sshd`). macOS: Configuración del Sistema › General › Compartir › Sesión remota. Windows: la característica opcional Servidor OpenSSH |

El instalador se detiene antes de descargar nada si falta Node.js, y avisa por lo demás.

## Instalar

**Linux o macOS**, en una terminal:

```sh
curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh
```

**Windows**, en una ventana de PowerShell normal (no «Ejecutar como administrador»):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://marssall.github.io/mars-ram/install.ps1 | iex"
```

Instala solo para tu usuario, sin permisos de administrador. Te pregunta qué entornos de Pi incluir y te pide confirmación.

## Después, vinculá tu teléfono

Abrí una terminal nueva y ejecutá:

```sh
mars-ram pair
```

Escaneá el código con la app.

## Qué hace el instalador

1. Revisa los requisitos.
2. Descarga una versión fija de mars-ram de las [versiones publicadas de MarsSall/mars-ram](https://github.com/MarsSall/mars-ram/releases).
3. Compara su SHA-256 con el valor escrito dentro del instalador. Si no coincide, borra la descarga y no instala nada.
4. Ejecuta `mars-ram install`, que copia mars-ram en `~/.mars-ram`, agrega el comando `mars-ram` y conecta el bridge de Pi.

## Leelo antes de ejecutarlo

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

## Más adelante

- `mars-ram doctor` revisa toda la instalación y dice qué arreglar.
- Para actualizar, ejecutá de nuevo el comando de instalación.
- `mars-ram uninstall` quita lo que agregó el instalador.

## Si algo sale mal

- **«mars-ram: command not found»**: abrí una terminal nueva. En Linux y macOS, agregá `~/.local/bin` al PATH si el instalador te lo indicó.
- **Windows dice que la ventana se ejecuta como administrador**: abrí PowerShell de forma normal y ejecutá el comando de nuevo.
- **La descarga no coincide con la suma de verificación**: no lo instales. Probá más tarde y avisanos si se repite.
