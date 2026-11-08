# Instalá mars-ram en tu computadora

Mars-RAM en tu teléfono habla con `mars-ram` en tu computadora. Instalalo una vez con un comando y después vinculá tu teléfono.

## Antes de empezar

| Necesitás | Para qué |
| --- | --- |
| [Node.js](https://nodejs.org) 24 o más nuevo | ejecuta mars-ram |
| [Pi](https://pi.dev) | las sesiones que ves en el teléfono |
| [Tailscale](https://tailscale.com) en la computadora y en el teléfono | la red privada entre los dos |
| Un servidor SSH | Linux: OpenSSH (`sshd`). macOS: Configuración del Sistema › General › Compartir › Sesión remota. Windows: la característica opcional Servidor OpenSSH |

`mars-ram doctor` revisa todo esto después de instalar.

## Instalar

En una terminal, igual en Linux, macOS y Windows:

```sh
pnpm add -g mars-ram
```

Es la forma recomendada. Con npm o Bun:

```sh
npm i -g mars-ram
```

```sh
bun add -g mars-ram
```

Si pnpm dice que la carpeta global de binarios no está configurada, ejecutá `pnpm setup` una vez, abrí una terminal nueva y ejecutá el comando de nuevo.

Después, configuralo para tu usuario:

```sh
mars-ram install
```

Instala solo para tu usuario, sin permisos de administrador. Te pregunta qué entornos de Pi incluir y te pide confirmación. En Windows, usá una terminal normal (no «Ejecutar como administrador»).

**Linux o macOS sin pnpm ni npm:** este script hace lo mismo en una línea:

```sh
curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh
```

En Windows, usá pnpm o npm.

## Después, vinculá tu teléfono

Abrí una terminal nueva y ejecutá:

```sh
mars-ram pair
```

Escaneá el código con la app.

## Qué hace el instalador

1. `pnpm add -g mars-ram` (o npm, o Bun) pone el paquete `mars-ram` del registro de npm en la carpeta global de tu gestor de paquetes. El paquete no ejecuta scripts de instalación; trae una versión fija de mars-ram y comprueba su SHA-256 antes de descomprimirla.
2. `mars-ram install` copia mars-ram en `~/.mars-ram` y conecta el bridge de Pi. El `mars-ram` del paquete sigue siendo tu comando; si una instalación anterior con el script dejó su propio comando `mars-ram`, lo quita (solo ese, nunca un archivo que no creó).

El script `curl … | sh` agrega su propio comando `mars-ram` (`~/.local/bin/mars-ram`). Revisa los requisitos, descarga una versión fija de las [versiones publicadas de MarsSall/mars-ram](https://github.com/MarsSall/mars-ram/releases), compara su SHA-256 con el valor escrito dentro del script (si no coincide, borra la descarga y no instala nada) y ejecuta `mars-ram install`.

## Leelo antes de ejecutarlo

El paquete de npm, en Linux, macOS y Windows (Windows 10 y posteriores traen `tar`). Descargalo sin instalarlo; `npm pack` muestra el nombre exacto del archivo, por ejemplo `mars-ram-0.1.2.tgz`:

```sh
npm pack mars-ram
```

Extraé ese archivo exacto, con el nombre que mostró:

```sh
tar -xzf mars-ram-0.1.2.tgz
```

Abrí `package/bin/mars-ram.mjs` (el programa que se ejecuta) y `package/README.md` con cualquier editor; en Windows sirve el Bloc de notas. El código es público: el lanzador es [`host/cli/npm/mars-ram.mjs`](https://github.com/MarsSall/mars-ram/blob/main/host/cli/npm/mars-ram.mjs) en [MarsSall/mars-ram](https://github.com/MarsSall/mars-ram), y `package/archive/` tiene el mismo archivo que la versión publicada en GitHub.

El script:

```sh
curl -fsSL https://marssall.github.io/mars-ram/install.sh -o install.sh
less install.sh
sh install.sh
```

## Más adelante

- `mars-ram doctor` revisa toda la instalación y dice qué arreglar.
- Para actualizar, ejecutá `pnpm add -g mars-ram` (o `npm i -g mars-ram`, o `bun add -g mars-ram`) y después `mars-ram install`. Si antes instalaste con el script `curl` y `mars-ram install` sigue ejecutando la versión vieja, ejecutá primero `mars-ram uninstall` y después `mars-ram install`. Si usás solo el script, ejecutá de nuevo el comando `curl`.
- `mars-ram uninstall` quita lo que agregó `mars-ram install`; el paquete queda. Después quitalo con `pnpm remove -g mars-ram`, `npm uninstall -g mars-ram` o `bun remove -g mars-ram`.

## Si algo sale mal

- **pnpm dice `No matching version found for mars-ram@latest`** justo después de una versión nueva: tu configuración de pnpm tiene una regla `minimumReleaseAge` que saltea versiones con pocos días. Exceptuá mars-ram en `~/.config/pnpm/config.yaml` con `minimumReleaseAgeExclude:` y, si también usás `trustPolicy: no-downgrade`, `trustPolicyExclude:`, cada una con la lista `- mars-ram`, esperá unos días o instalá con `npm i -g mars-ram`.
- **«mars-ram: command not found»**: abrí una terminal nueva. Con pnpm, ejecutá `pnpm setup` una vez si dice que la carpeta global de binarios no está configurada. En Linux y macOS con el script, agregá `~/.local/bin` al PATH si te lo indicó.
- **Node.js es muy viejo**: instalá Node.js 24 o más nuevo y ejecutá de nuevo el comando de instalación.
- **Windows dice que la terminal se ejecuta como administrador**: abrí una terminal normal y ejecutá el comando de nuevo.
- **La descarga no coincide con la suma de verificación**: no lo instales. Probá más tarde y avisanos si se repite.
