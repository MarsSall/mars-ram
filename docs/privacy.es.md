# Política de privacidad

**Vigente desde el 3 de noviembre de 2026**

Mars-RAM no tiene cuentas ni una nube operada por nosotros. No incluimos analíticas, publicidad ni seguimiento. Tu trabajo queda en tu teléfono y tus computadoras, sujeto a los servicios que elijas usar en ellos.

## Conexiones y terceros

La app se conecta a tus computadoras por tu red Tailscale, principalmente mediante SSH. El emparejamiento también envía una solicitud directamente a tu computadora por esa red. Tailscale es un servicio separado y se aplican sus propias prácticas de privacidad. El contenido de las sesiones y los adjuntos llegan a tu computadora y a los programas que uses ahí, incluidos los agentes o proveedores de modelos que elijas. Esos programas pueden manejar los datos según sus propias políticas.

Si descargás el modelo de voz en el dispositivo, la app hace una solicitud HTTPS de descarga a **huggingface.co**; Hugging Face y cualquier servidor de descarga alcanzado mediante redirecciones pueden ver tu IP y la información habitual de la solicitud. Al abrir la política de privacidad, el código fuente u otro enlace externo, se usa tu navegador y se contacta al sitio correspondiente.

## Información en tu teléfono

- Las computadoras guardadas incluyen nombre, dirección, usuario, puerto e identidad verificada. La clave SSH privada de la app queda en Android Keystore; por defecto requiere desbloquear el dispositivo.
- La app guarda ajustes como el tema y la retención de adjuntos, atajos de sesiones y el modelo de voz descargado. La selección de idioma actualmente dura lo que dura la sesión de la app. Los borradores quedan en memoria; los archivos multimedia elegidos también pueden quedar en la caché del teléfono.
- La app accede al micrófono cuando lo mantenés apretado o bloqueado, y brevemente después de un toque corto mientras espera un posible segundo toque. El audio queda en memoria, se transcribe en el teléfono con Parakeet y no se escribe en disco ni se envía por la red. El texto resultante se coloca en el borrador del chat o en la terminal; vos controlás su envío.
- La cámara escanea códigos QR de emparejamiento y también puede sacar una foto cuando la elegís como adjunto. La app no guarda ni envía los fotogramas del QR; una foto que elijas puede quedar en caché y subirse.

## Archivos en tu computadora

Los adjuntos se copian a `~/.mars-ram/uploads` en la computadora elegida. La limpieza se intenta cuando la app se conecta, según tu ajuste: 1, 7 o 30 días, o nunca. Los links privados usan copias en `~/.mars-ram/links`; tu computadora los sirve en tu tailnet. Cualquier persona en esa red que tenga el link puede abrirlo hasta que venza o se borre. Los links vencen después de un día.

## Borrar datos

- Desinstalá la app de Android para borrar sus datos y su clave de Keystore del teléfono. Las copias en tus computadoras no se borran.
- Usá **Olvidar esta computadora** para quitar su identidad guardada de la app. La clave pública del teléfono sigue autorizada en esa computadora hasta que la quites ahí.
- Usá **Borrar el modelo de voz** en ajustes para quitar el modelo descargado.
- En una computadora, `mars-ram uninstall` quita la integración instalada, pero conserva los archivos compartidos, los datos de links, las claves de autorización de teléfonos y el registro de sesiones. Borrá las copias y claves que no quieras en la computadora por separado.

## Contacto

Consultas sobre privacidad: kiwi348@gmail.com.
