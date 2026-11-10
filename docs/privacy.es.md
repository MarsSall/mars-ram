# Política de privacidad

**Vigente desde el 8 de noviembre de 2026**

Mars-RAM no tiene cuentas ni una nube operada por nosotros. No incluimos analíticas, publicidad ni seguimiento. Tu trabajo queda en tu teléfono y tus computadoras, sujeto a los servicios que elijas usar en ellos.

## Conexiones y terceros

La app se conecta a tus computadoras por tu red Tailscale, principalmente mediante SSH. El emparejamiento también envía una solicitud directamente a tu computadora por esa red. Tailscale es un servicio separado y se aplican sus propias prácticas de privacidad. El contenido de las sesiones y los adjuntos llegan a tu computadora y a los programas que uses ahí, incluidos los agentes o proveedores de modelos que elijas. Esos programas pueden manejar los datos según sus propias políticas.

Si descargás el modelo de voz en el dispositivo, la app hace una solicitud HTTPS de descarga a **huggingface.co**; Hugging Face y cualquier servidor de descarga alcanzado mediante redirecciones pueden ver tu IP y la información habitual de la solicitud. Al abrir la política de privacidad, el código fuente u otro enlace externo, se usa tu navegador y se contacta al sitio correspondiente.

Para saber si hay una versión más nueva para la computadora, la app hace una solicitud HTTPS GET a **registry.npmjs.org/mars-ram/latest**, como máximo una vez por día al comprobar las computadoras conectadas. npm puede ver tu IP y los datos habituales de la solicitud. No se envían nombres ni direcciones de tus computadoras, contenido de sesiones, adjuntos ni credenciales. El teléfono guarda la hora del último intento y la última versión pública validada; si no hay conexión o falla la consulta, no se muestra un error ni se reintenta ese día. Esta comprobación opcional solo sirve para avisar de una actualización y nunca instala nada.

Si instalaste la app desde Google Play, la app le pregunta a la app de Google Play de tu teléfono si hay una versión más nueva de Mars-RAM, como máximo una vez por día. Google Play hace esa comprobación según las políticas de Google; la app no nos envía nada ni agrega información propia. Si elegís «Actualizar», Google Play descarga e instala la versión nueva. Las versiones instaladas por fuera de Google Play saltean la comprobación sin avisar.

## Avisos de sesiones opcionales

Los avisos vienen apagados. Android 13 o posterior pide permiso de notificaciones cuando activás un modo. **Mientras trabajan** observa tus computadoras guardadas por SSH y se detiene tras dos minutos sin sesiones trabajando o esperando respuesta, o dos horas sin cambios de estado. **Siempre atento** escucha en la dirección Tailscale del teléfono; cada computadora envía avisos autenticados con el nombre del proyecto y el estado directamente dentro de tu tailnet. Estos avisos no usan un relay externo, Firebase, analíticas ni otro proveedor de notificaciones de terceros. Siguen aplicando las políticas propias de Tailscale. No incluyen texto del agente; los ajustes de pantalla bloqueada de Android controlan su visibilidad.

El teléfono guarda el modo elegido y, para Siempre atento, una clave aleatoria por computadora y cursores contra repeticiones. Las claves y cursores están cifrados con una clave no exportable de Android Keystore en almacenamiento excluido de las copias de seguridad. A diferencia de la clave SSH, esta clave sólo para avisos no exige desbloquear el dispositivo: permite escuchar mientras SSH está bloqueado. La computadora vinculada guarda su copia de la clave, la dirección y el puerto Tailscale del teléfono y su identidad en archivos privados bajo `~/.mars-ram/notify`. Las claves se intercambian sólo por la entrada estándar de SSH autenticado, nunca como argumentos de comandos. El proceso existente del servidor de links sigue ejecutándose mientras haya teléfonos registrados.

Siempre atento necesita Tailscale encendido y excluir la app de la optimización de batería; no puede detectar una conexión perdida. No se garantiza la entrega bajo Doze o restricciones del fabricante. No hay avisos después de forzar la detención o si muere el proceso, ni reinicio automático al encender el teléfono.

## Información en tu teléfono

- Las computadoras guardadas incluyen nombre, dirección, usuario, puerto e identidad verificada. La clave SSH privada de la app queda en Android Keystore; por defecto requiere desbloquear el dispositivo.
- La app guarda ajustes como el tema y la retención de adjuntos, atajos de sesiones y el modelo de voz descargado. También recuerda la última versión cuyas «Novedades» viste y la hora y la respuesta de la última comprobación de actualizaciones en Google Play. La selección de idioma actualmente dura lo que dura la sesión de la app. Los borradores quedan en memoria; los archivos multimedia elegidos también pueden quedar en la caché del teléfono.
- La app accede al micrófono cuando lo mantenés apretado o bloqueado, y brevemente después de un toque corto mientras espera un posible segundo toque. El audio queda en memoria, se transcribe en el teléfono con Parakeet y no se escribe en disco ni se envía por la red. El texto resultante se coloca en el borrador del chat o en la terminal; vos controlás su envío.
- La cámara escanea códigos QR de emparejamiento y también puede sacar una foto cuando la elegís como adjunto. La app no guarda ni envía los fotogramas del QR; una foto que elijas puede quedar en caché y subirse.

## Archivos en tu computadora

Los adjuntos se copian a una carpeta privada de tu usuario en la carpeta temporal de la computadora elegida (`/tmp/mars-ram-<uid>/uploads` en Linux, `%TEMP%\mars-ram\uploads` en Windows), no a tu carpeta personal. La computadora rechaza la carpeta si es de otro usuario o si otros pueden abrirla. La limpieza se intenta cuando la app se conecta, según tu ajuste: 1, 7 o 30 días, o nunca; el sistema también puede vaciar su carpeta temporal, por ejemplo al reiniciar. Al actualizar la parte de la computadora con `mars-ram install` se borran los adjuntos que las versiones anteriores guardaban en `~/.mars-ram/uploads`; `mars-ram uninstall` borra las dos carpetas. Los links privados usan copias en `~/.mars-ram/links`; tu computadora los sirve en tu tailnet. Cualquier persona en esa red que tenga el link puede abrirlo hasta que venza o se borre. Los links vencen después de un día.

## Borrar datos

- Desinstalá la app de Android para borrar sus datos y su clave de Keystore del teléfono. Las copias en tus computadoras no se borran.
- Usá **Olvidar esta computadora** para quitar su identidad guardada y la clave local de avisos con sus cursores. Cambiar de Siempre atento a otro modo también borra las claves locales de avisos e intenta ejecutar `mars-ram notify unregister` por SSH. La baja remota es un intento: una computadora desconectada puede conservar el registro y seguir intentando, pero el teléfono rechaza sus avisos sin la clave local. Podés quitar el registro remoto desde la conexión SSH de ese teléfono con `mars-ram notify unregister`. La clave SSH pública del teléfono sigue autorizada en esa computadora hasta que la quites ahí.
- Usá **Borrar el modelo de voz** en ajustes para quitar el modelo descargado.
- En una computadora, `mars-ram uninstall` quita la integración instalada, pero conserva los archivos compartidos, los datos de links, las claves de autorización de teléfonos y el registro de sesiones. Borrá las copias y claves que no quieras en la computadora por separado.

## Contacto

Consultas sobre privacidad: kiwi348@gmail.com.
