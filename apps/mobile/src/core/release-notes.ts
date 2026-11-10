// What changed in each release, in plain words, bundled with the app.
// Every release adds one entry keyed by its Android versionCode (see the
// release-and-distribution skill). Keep both languages with the same items.

export type ReleaseNoteText = { new: string[]; fixes: string[] };
export type ReleaseNote = { build: number; version: string; es: ReleaseNoteText; en: ReleaseNoteText };

export const RELEASE_NOTES: ReleaseNote[] = [
 {
  build: 10,
  version: "1.0.0",
  es: {
   new: [
    "Podés personalizar las teclas de la terminal, la barra de abajo y el D-pad flotante: las ordenás arrastrando, elegís de una lista y creás tus propios botones. Un botón que termina con Enter se manda manteniéndolo apretado. Está en Ajustes › Personalizar teclas.",
    "Los enlaces privados y Siempre atento ahora funcionan también con ZeroTier. Necesita mars-ram 0.1.6 en la compu: la app te da los comandos para actualizar.",
    "El explorador del proyecto oculta los archivos secretos, como .env y claves privadas, hasta que tocás Mostrar. Lo podés apagar en Ajustes.",
   ],
   fixes: [
    "El explorador del proyecto ya no abre archivos con enlaces duros, que podían mostrar archivos de fuera del proyecto. Necesita mars-ram 0.1.6 en la compu.",
   ],
  },
  en: {
   new: [
    "You can customize the terminal keys, the bar at the bottom and the floating D-pad: reorder them by dragging, pick from a list and create your own buttons. A button that ends with Enter is sent by holding it. It's in Settings › Customize keys.",
    "Private links and Always attentive now work with ZeroTier too. This needs mars-ram 0.1.6 on the computer: the app gives you the commands to update.",
    "The project browser hides secret files, like .env and private keys, until you tap Show. You can turn this off in Settings.",
   ],
   fixes: [
    "The project browser no longer opens hard-linked files, which could show files from outside the project. This needs mars-ram 0.1.6 on the computer.",
   ],
  },
 },
 {
  build: 9,
  version: "1.0.0",
  es: {
   new: [
    "Un asistente para conectar tu compu paso a paso. Si algo falla, te dice qué revisar.",
    "Podés conectar tu compu con ZeroTier como alternativa a Tailscale.",
    "Los archivos que adjuntás ahora van a una carpeta temporal privada de tu compu, que se limpia sola. Necesita mars-ram 0.1.5 en la compu: la app te da los comandos para actualizar.",
   ],
   fixes: [
    "El modelo de voz se descarga en segundo plano y sigue aunque cierres la app; ya no vuelve a empezar de cero.",
    "La terminal recuerda el tamaño de letra que elegiste, y lo podés cambiar en Ajustes.",
    "Si al conectar tu compu el DNS privado del teléfono no la deja encontrar, la app te avisa enseguida y te dice que lo apagues, en vez de quedarse esperando.",
    "La terminal ya no muestra sugerencias del teclado, así que no se duplica lo que escribís.",
    "Conectar una Mac funciona aunque Tailscale esté instalado como app.",
   ],
  },
  en: {
   new: [
    "A step-by-step assistant to connect your computer. If something fails, it tells you what to check.",
    "You can connect your computer with ZeroTier as an alternative to Tailscale.",
    "Files you attach now go to a private temporary folder on your computer that cleans itself up. This needs mars-ram 0.1.5 on the computer: the app gives you the commands to update.",
   ],
   fixes: [
    "The voice model downloads in the background and keeps going even if you close the app; it no longer starts over from zero.",
    "The terminal remembers the text size you chose, and you can change it in Settings.",
    "If the phone's Private DNS keeps the app from finding your computer while connecting it, the app tells you right away to turn it off instead of waiting.",
    "The terminal no longer shows keyboard suggestions, so what you type isn't duplicated.",
    "Connecting a Mac works even when Tailscale is installed as an app.",
   ],
  },
 },
 {
  build: 8,
  version: "1.0.0",
  es: {
   new: [
    "Inicio y Computadoras te avisan cuando tu computadora necesita una actualización y te dan los comandos listos para copiar. Si una sesión lo necesita, te recuerda escribir /reload.",
    "El acceso al chat en la terminal sigue al panel que tenés elegido en Herdr, con Pi y con Gentle Shell.",
    "Avisos de tus sesiones con tres modos en Ajustes: Apagado, Mientras trabajan y Siempre atento. La explicación de cada uno está en el «?».",
    "Tocar un aviso abre esa sesión.",
    "Esta pantalla de novedades después de cada actualización, y un aviso cuando Google Play tiene una versión nueva de la app.",
   ],
   fixes: [
    "Ajustes ya no muestra una opción de notificaciones que no hacía nada.",
    "La app se recupera sola si una conexión se queda trabada después de desbloquear el teléfono.",
   ],
  },
  en: {
   new: [
    "Home and Computers tell you when your computer needs an update and give you the commands ready to copy. When a session needs it, they remind you to type /reload.",
    "The chat button in the terminal follows the pane you have selected in Herdr, with Pi and with Gentle Shell.",
    "Session notices with three modes in Settings: Off, While working and Always attentive. Each one is explained behind the «?».",
    "Tapping a notice opens that session.",
    "This what's-new screen after each update, and a notice when Google Play has a new version of the app.",
   ],
   fixes: [
    "Settings no longer shows a notifications option that did nothing.",
    "The app recovers by itself if a connection gets stuck after you unlock the phone.",
   ],
  },
 },
];
