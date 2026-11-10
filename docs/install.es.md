# Instalá mars-ram en tu computadora

Mars-RAM en tu teléfono habla con `mars-ram` en tu computadora. Instalalo una vez con un comando y después vinculá tu teléfono.

## Antes de empezar

| Necesitás | Para qué |
| --- | --- |
| [Node.js](https://nodejs.org) 24 o más nuevo | ejecuta mars-ram |
| [Pi](https://pi.dev) | las sesiones que ves en el teléfono |
| [Tailscale](https://tailscale.com) en la computadora y en el teléfono | la red privada entre los dos (en macOS alcanza con la app de Tailscale: mars-ram encuentra su comando dentro de `Tailscale.app`) |
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

Escaneá el código con la app. En Windows, si tu usuario es administrador, ejecutá `mars-ram pair` en una terminal de administrador: la computadora te pide ahí que autorices el teléfono.

¿Usás ZeroTier en vez de Tailscale? Uní la computadora a tu red de ZeroTier, autorizala en ZeroTier Central y ejecutá `mars-ram pair-zt`; si la computadora está en varias redes de ZeroTier, te muestra sus direcciones y elegís una con `--address <ipv4>`. Necesita una versión de la app compatible con ZeroTier. Por ZeroTier tenés las sesiones por SSH, la terminal y los archivos y, con la app actualizada y `mars-ram install`, también los links privados y Siempre atento. Un link privado se sirve entonces solo en la dirección de ZeroTier de la computadora (la que usó el teléfono al vincularse), nunca en la red local, y su URL es `http://<IPv4 de ZeroTier>:47811/l/…`. Siempre atento registra el teléfono por esa misma conexión de ZeroTier y le manda los avisos a su dirección de ZeroTier. Android usa una sola VPN a la vez: los avisos de una computadora con ZeroTier llegan solo mientras ZeroTier está encendido, y los de una con Tailscale, solo mientras Tailscale está encendido. Si la misma computadora está vinculada por Tailscale y por ZeroTier, guarda solo el último registro de Siempre atento del teléfono, así que sus avisos llegan por esa red. En Linux, un firewall (ufw o firewalld) bloquea ZeroTier hasta que lo dejes pasar: si hay uno activo, `mars-ram pair-zt` y `mars-ram doctor` muestran el comando exacto con el nombre de la interfaz, como `sudo ufw allow in on <interfaz de ZeroTier> comment 'ZeroTier'`; esa sola regla cubre tanto SSH como los links privados (el puerto 47811 de la computadora), y Siempre atento no necesita nada más: sus avisos salen de la computadora hacia el puerto 47812 del teléfono, que las reglas de salida por defecto permiten, y el teléfono no necesita cambios de firewall (Tailscale no lo necesita).

En la app, **Agregar computadora** primero te pregunta qué red usás, Tailscale (recomendado) o ZeroTier, y lo recuerda; lo podés cambiar en el primer paso. Después te guía paso a paso: revisa Tailscale y el DNS privado en el teléfono (o, con ZeroTier, que la app de ZeroTier esté instalada y encendida; Android usa una sola VPN a la vez) y sigue solo cuando están bien, te muestra estos comandos para Linux, macOS o Windows con botones para copiar y, si el escaneo falla o se traba, **Ver qué pasa** te dice la causa probable y cómo arreglarla. **Ya sé, escanear** va directo a la cámara; **Agregar a mano** sigue disponible desde el paso de escaneo.

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
- Para actualizar, ejecutá `pnpm add -g mars-ram` (o `npm i -g mars-ram`, o `bun add -g mars-ram`) y después `mars-ram install`. Si antes instalaste con el script `curl` y `mars-ram install` sigue ejecutando la versión vieja, ejecutá primero `mars-ram uninstall` y después `mars-ram install`. Si usás solo el script, ejecutá de nuevo el comando `curl`. Si después de actualizar `mars-ram doctor` dice que hay copias desactualizadas, ejecutá `mars-ram install` otra vez.
- `mars-ram uninstall` quita lo que agregó `mars-ram install`; el paquete queda. Después quitalo con `pnpm remove -g mars-ram`, `npm uninstall -g mars-ram` o `bun remove -g mars-ram`.

## Si algo sale mal

- **pnpm dice `No matching version found for mars-ram@latest`** justo después de una versión nueva: tu configuración de pnpm tiene una regla `minimumReleaseAge` que saltea versiones con pocos días. Exceptuá mars-ram en `~/.config/pnpm/config.yaml` con `minimumReleaseAgeExclude:` y, si también usás `trustPolicy: no-downgrade`, `trustPolicyExclude:`, cada una con la lista `- mars-ram`, esperá unos días o instalá con `npm i -g mars-ram`.
- **«mars-ram: command not found»**: abrí una terminal nueva. Con pnpm, ejecutá `pnpm setup` una vez si dice que la carpeta global de binarios no está configurada. En Linux y macOS con el script, agregá `~/.local/bin` al PATH si te lo indicó.
- **Node.js es muy viejo**: instalá Node.js 24 o más nuevo y ejecutá de nuevo el comando de instalación.
- **Windows dice que la terminal se ejecuta como administrador**: abrí una terminal normal y ejecutá el comando de nuevo.
- **La vinculación dice que el teléfono no encuentra la computadora por su nombre de Tailscale**: el DNS privado de Android saltea el MagicDNS de Tailscale. Apagalo en el teléfono (Ajustes › Conexiones › Más ajustes de conexión › DNS privado › Desactivado) y escaneá un código nuevo.
- **La descarga no coincide con la suma de verificación**: no lo instales. Probá más tarde y avisanos si se repite.
