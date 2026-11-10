<a id="top"></a>

<p align="right">
  <a href="./README.md"><img src="https://img.shields.io/badge/English-D9B45F?style=for-the-badge&labelColor=0B1A12" alt="English" /></a>
  <img src="https://img.shields.io/badge/Espa%C3%B1ol-0A4F31?style=for-the-badge&labelColor=0B1A12" alt="Español" />
</p>

<p align="center">
  <img src="./docs/assets/brand/mars-ram-banner.svg" width="1200" alt="MARS-RAM — Tu computadora. Tus agentes. Tu teléfono." />
</p>

<p align="center">
  <img src="./apps/mobile/assets/brand/carnero.png" alt="Ícono de Mars-RAM: un carnero dorado" width="96" />
</p>

<h1 align="center">Mars-RAM</h1>

<p align="center"><strong>Las sesiones de agentes de programación de tu computadora, desde tu teléfono Android.</strong></p>

<div align="center">

[![npm](https://img.shields.io/npm/v/mars-ram?style=for-the-badge&labelColor=0B1A12&color=5CCB94)](https://www.npmjs.com/package/mars-ram)
[![CI](https://img.shields.io/github/actions/workflow/status/MarsSall/mars-ram/ci.yml?branch=main&style=for-the-badge&labelColor=0B1A12&color=0A4F31&label=CI)](https://github.com/MarsSall/mars-ram/actions/workflows/ci.yml)
[![Último commit](https://img.shields.io/github/last-commit/MarsSall/mars-ram?style=for-the-badge&labelColor=0B1A12&color=D9B45F)](https://github.com/MarsSall/mars-ram/commits)
[![Estrellas](https://img.shields.io/github/stars/MarsSall/mars-ram?style=for-the-badge&labelColor=0B1A12&color=D9B45F)](https://github.com/MarsSall/mars-ram/stargazers)

![Android](https://img.shields.io/badge/Android-5CCB94?style=for-the-badge&labelColor=0B1A12)
![Linux · macOS · Windows](https://img.shields.io/badge/Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-0A4F31?style=for-the-badge&labelColor=0B1A12)

</div>

<p align="center"><strong><a href="#install">Instalación</a> &nbsp;·&nbsp; <a href="#screenshots">Capturas</a> &nbsp;·&nbsp; <a href="./docs/install.es.md">Documentación</a> &nbsp;·&nbsp; <a href="./docs/privacy.es.md">Privacidad</a></strong></p>

<p align="center">Tus agentes siguen trabajando en tu escritorio. Vos no tenés que quedarte ahí.<br /><strong>Seguí las sesiones de agentes en vivo, respondé desde el chat o la terminal completa y retomá el trabajo en tu computadora.</strong></p>

<p align="center"><sub><strong>HECHO PARA AGENTES DE PROGRAMACIÓN</strong> &nbsp;·&nbsp; Tailscale o ZeroTier &nbsp;·&nbsp; Sin cuenta de Mars-RAM &nbsp;·&nbsp; Sin nube operada por nosotros</sub></p>

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<a id="stack"></a>

## Stack

<div align="center">
<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>
</div>

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&labelColor=0B1020&logo=typescript&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&labelColor=0B1020&logo=react&logoColor=61DAFB)
![Expo](https://img.shields.io/badge/Expo-000020?style=for-the-badge&labelColor=0B1020&logo=expo&logoColor=white)
![Kotlin](https://img.shields.io/badge/Kotlin-7F52FF?style=for-the-badge&labelColor=0B1020&logo=kotlin&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&labelColor=0B1020&logo=nodedotjs&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&labelColor=0B1020&logo=pnpm&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&labelColor=0B1020&logo=vitest&logoColor=white)
![Tailscale](https://img.shields.io/badge/Tailscale-242424?style=for-the-badge&labelColor=0B1020&logo=tailscale&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&labelColor=0B1020&logo=githubactions&logoColor=white)

</div>

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<a id="what-is-it"></a>

## Qué es

Mars-RAM (Remote Agent Manager) conecta tu teléfono Android con tus propias computadoras por SSH, sobre tu red de Tailscale o, como alternativa, de ZeroTier. Seguí las sesiones de agentes en vivo, respondé desde el chat o la terminal completa y retomá el trabajo en tu escritorio.

Sesiones en vivo con chat: hoy con Pi; se van a sumar más agentes. La terminal completa de Herdr funciona con cualquier agente o programa.

Sin cuenta de Mars-RAM ni servicio en la nube operado por nosotros. Las sesiones corren en tus computadoras; el teléfono es otra forma de acceder a ellas.

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<a id="install"></a>

## Instalación

**App para Android:** Google Play — próximamente.

**En tu computadora**, necesitás:

- [Node.js](https://nodejs.org) **24 o más nuevo** y [Pi](https://pi.dev) para las sesiones en vivo con chat.
- [Tailscale](https://tailscale.com) en la computadora y en el teléfono (o ZeroTier, mirá más abajo). En macOS alcanza con la app de Tailscale: Mars-RAM encuentra su comando dentro de `Tailscale.app`.
- Un servidor SSH: `sshd` en Linux, **Sesión remota** (Remote Login) en macOS u **OpenSSH Server** en Windows.

Instalá el comando para la computadora con pnpm (recomendado):

```sh
pnpm add -g mars-ram
mars-ram install
mars-ram pair
```

Escaneá el código QR desde la app o abrí en el teléfono el link de vinculación que aparece en la terminal. En la app, **Agregar computadora** te guía paso a paso por Tailscale o ZeroTier: revisa la app de red del teléfono (y el DNS privado, con Tailscale), te da estos comandos para cada sistema y te explica por qué falló un escaneo. La instalación es para tu usuario, sin permisos de administrador; en Windows, usá una terminal normal para `mars-ram install`, y una terminal de administrador para `mars-ram pair` si tu usuario es administrador.

**¿ZeroTier en vez de Tailscale?** Ejecutá `mars-ram pair-zt` (agregá `--address <ipv4>` si la computadora está en varias redes de ZeroTier). Necesita una versión de la app compatible con ZeroTier; por ZeroTier funcionan las sesiones por SSH, la terminal y los archivos, mientras que los links privados y Siempre atento siguen necesitando Tailscale. `mars-ram pair` sigue usando Tailscale. En Linux con un firewall (ufw o firewalld) activo, `pair-zt` y `mars-ram doctor` muestran el comando exacto para dejar pasar ZeroTier, como `sudo ufw allow in on <interfaz de ZeroTier> comment 'ZeroTier'`; Tailscale no lo necesita.

¿Preferís npm? Reemplazá el primer comando por `npm i -g mars-ram`.

**Alternativa para Linux / macOS:**

```sh
curl -fsSL https://marssall.github.io/mars-ram/install.sh | sh
```

Después ejecutá `mars-ram pair`. La [guía de instalación completa](./docs/install.es.md) explica los requisitos, cómo revisar el instalador antes de ejecutarlo y cómo resolver problemas.

**Actualizar:** ejecutá de nuevo `pnpm add -g mars-ram` (o `npm i -g mars-ram`) y después `mars-ram install`. La versión 9 de la app necesita mars-ram 0.1.5 y te da los comandos para actualizar; después, escribí `/reload` en cada sesión de Pi que ya esté abierta. Si `mars-ram doctor` sigue diciendo que hay copias desactualizadas, ejecutá `mars-ram install` otra vez. Mirá el [registro de cambios](./CHANGELOG.md) (en inglés).

**Diagnosticar:** ejecutá `mars-ram doctor` para revisar la configuración sin modificarla.

**¿El teléfono no encuentra la computadora por Tailscale?** El DNS privado de Android saltea el MagicDNS de Tailscale. Apagalo (Ajustes › Conexiones › Más ajustes de conexión › DNS privado › Desactivado) y escaneá un código nuevo; la app te avisa cuando lo detecta.

**Desinstalar:** ejecutá `mars-ram uninstall` y después `pnpm remove -g mars-ram` (o `npm uninstall -g mars-ram`). Esto quita la integración y el paquete, no los archivos compartidos ni la autorización del teléfono en la computadora; mirá [Privacidad y datos locales](#privacidad-y-datos-locales).

<a id="quick-start"></a>

## Primeros pasos

Una vez vinculado el teléfono:

1. Abrí tu computadora en la app y elegí una sesión de agentes en vivo para seguirla o responder.
2. Usá la terminal completa de Herdr cuando necesites el teclado, o el chat para enviar una instrucción, foto o archivo.
3. Agregá un atajo para abrir Gentle Shell, Pi u OpenCode en un repositorio sin escribir el comando cada vez.

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<a id="screenshots"></a>

## Capturas

<p align="center">App para Android · Interfaz en español · Contenido de demostración</p>

<table align="center">
  <tr>
    <td align="center"><img src="./docs/screenshots/01-welcome.png" alt="Pantalla de bienvenida con el comando de instalación en la computadora" width="230" /><br /><sub><strong>Bienvenida</strong></sub></td>
    <td align="center"><img src="./docs/screenshots/02-home.png" alt="Inicio con un atajo y una sesión trabajando" width="230" /><br /><sub><strong>Sesiones de un vistazo</strong></sub></td>
    <td align="center"><img src="./docs/screenshots/03-shortcut-program.png" alt="Selector de programa para un atajo a un repositorio" width="230" /><br /><sub><strong>Atajos guiados</strong></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="./docs/screenshots/04-project-files.png" alt="Archivos del proyecto con colores según su estado en git" width="230" /><br /><sub><strong>Archivos del proyecto</strong></sub></td>
    <td align="center"><img src="./docs/screenshots/05-settings.png" alt="Pantalla de ajustes de la app" width="230" /><br /><sub><strong>Ajustes</strong></sub></td>
    <td align="center"><img src="./docs/screenshots/06-send-photo.png" alt="Una foto adjunta en el chat de una sesión, lista para enviar" width="230" /><br /><sub><strong>Fotos en el chat</strong></sub></td>
  </tr>
</table>

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<a id="features"></a>

## Funciones

| Función | Qué podés hacer |
| --- | --- |
| **Conexión guiada** | Agregá una computadora paso a paso por Tailscale o ZeroTier; si el escaneo falla, la app te dice qué revisar. |
| **ZeroTier como alternativa** | Vinculá con `mars-ram pair-zt` para las sesiones, la terminal y los archivos; los links privados y Siempre atento siguen necesitando Tailscale. |
| **Sesiones de agentes en vivo** | Leé, respondé y frená una sesión desde el teléfono. |
| **Terminal completa** | Usá cualquier agente o programa en Herdr, con una barra de teclas pensada para una mano y sin sugerencias del teclado. Recuerda el tamaño de letra; cambialo pellizcando o en Ajustes. |
| **Atajos guiados** | Abrí Gentle Shell, Pi u OpenCode en un repositorio. |
| **Archivos del proyecto** | Explorá archivos con su estado en git, diffs e historial. |
| **Dictado en el dispositivo** | Convertí voz en texto en tu teléfono; el audio no se envía por la red. El modelo de voz se descarga en segundo plano, aunque cierres la app. |
| **Fotos y archivos** | Adjuntalos a una sesión (quedan en una carpeta temporal privada de tu usuario en la computadora) o compartí una copia con un link privado en tu tailnet. |
| **Vinculación por QR o link** | La clave privada SSH queda en el Keystore de Android y, por defecto, requiere desbloquear el dispositivo. |

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<a id="architecture"></a>

## Arquitectura

| Ruta | Responsabilidad |
| --- | --- |
| [`apps/mobile`](./apps/mobile/) | Cliente Android: interfaz en React Native / Expo y módulo SSH nativo en Kotlin |
| [`host/cli`](./host/cli/) | Instalación, vinculación, diagnóstico y herramientas de archivos y Git en la computadora |
| [`host/pi-bridge`](./host/pi-bridge/) | Extensión de Pi que expone cada sesión en vivo por HTTP local y eventos |
| [`host/link-server`](./host/link-server/) | Sirve copias privadas de archivos con vencimiento en la dirección de Tailscale de la computadora |
| [`packages/protocol`](./packages/protocol/) | Esquemas compartidos y versionados de solicitudes, respuestas y eventos, con pruebas de contrato |
| [`docs/`](./docs/) | Instalación, arquitectura, privacidad y documentación técnica |

La app, los componentes de la computadora y el protocolo siguen límites hexagonales: reglas en el núcleo y tecnología detrás de puertos y adaptadores. Consultá el [documento de arquitectura](./docs/architecture.md) (en inglés).

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<a id="privacy-and-local-data"></a>
<a id="privacidad-y-datos-locales"></a>

## Privacidad y datos locales

- **Sin analítica, publicidad ni rastreo.** Mars-RAM no opera un backend. Tailscale y los agentes o proveedores de modelos que uses tienen sus propias políticas; el contenido que enviás a una sesión llega a esos programas en tu computadora.
- **Datos en el teléfono.** Las computadoras guardadas, sus identidades verificadas, los ajustes y el modelo de voz descargado quedan en el almacenamiento de la app; la clave privada SSH queda en el Keystore de Android. Los borradores y el audio del dictado se mantienen en memoria. Las fotos y los archivos elegidos pueden quedar en caché.
- **Voz.** La transcripción corre en el dispositivo. Descargar el modelo de voz opcional contacta a Hugging Face y a los servidores de descarga a los que redirija; pueden ver información habitual de la solicitud, incluida tu dirección IP.
- **Datos en la computadora.** Los adjuntos van a una carpeta privada de tu usuario dentro de la carpeta temporal del sistema (`/tmp/mars-ram-<uid>/uploads` en Linux y macOS, `%TEMP%\mars-ram\uploads` en Windows), nunca a tu carpeta personal, con limpieza al conectar cuando sea posible (1, 7 o 30 días, o nunca) y lo que borre la limpieza de temporales del sistema. `mars-ram install` borra la carpeta anterior `~/.mars-ram/uploads`. Los links privados sirven copias de `~/.mars-ram/links` durante un día; cualquier persona de la tailnet que tenga el link puede abrirlo hasta que venza o lo borres.
- **Borrado.** Desinstalar la app de Android elimina sus datos y su clave, no las copias en tus computadoras. Olvidar una computadora no revoca su clave pública autorizada. `mars-ram uninstall` conserva archivos compartidos, datos de links, claves de autorización del teléfono y el registro de sesiones; borrá por separado las copias y claves que ya no quieras.

Leé la [política de privacidad completa](./docs/privacy.es.md).

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<a id="contributing"></a>

## Cómo contribuir

Las preguntas, los reportes de errores y las sugerencias son bienvenidos en [GitHub Issues](https://github.com/MarsSall/mars-ram/issues). Reportá vulnerabilidades de seguridad en privado: [abrí un aviso de seguridad privado en GitHub](https://github.com/MarsSall/mars-ram/security/advisories/new), no un issue público. Publicar el código para su revisión no otorga una licencia para reutilizarlo.

<a id="license"></a>

## Licencia

Copyright © 2026 MarsSall. Todos los derechos reservados. El código fuente se publica para ofrecer transparencia y permitir su revisión; no se otorga ninguna licencia para copiarlo, modificarlo o redistribuirlo.

Mars-RAM no está afiliado a las herramientas y los servicios con los que se conecta. Las marcas pertenecen a sus respectivos titulares.

<p align="center"><img src="./docs/assets/brand/divider.svg" width="480" alt="" /></p>

<p align="center"><sub><strong>Si Mars-RAM te ayuda a seguir conectado con tu trabajo, <a href="https://github.com/MarsSall/mars-ram/stargazers">una estrella ayuda a que otras personas lo descubran.</a></strong></sub></p>

<p align="center"><a href="#top">Volver arriba ↑</a></p>
