// What changed in each release, in plain words, bundled with the app.
// Every release adds one entry keyed by its Android versionCode (see the
// release-and-distribution skill). Keep both languages with the same items.

export type ReleaseNoteText = { new: string[]; fixes: string[] };
export type ReleaseNote = { build: number; version: string; es: ReleaseNoteText; en: ReleaseNoteText };

export const RELEASE_NOTES: ReleaseNote[] = [
 {
  build: 15,
  version: "1.0.0",
  es: {
   new: [
    "Sesiones de Claude Code y Codex en vivo, como con Pi: ves la conversación, les escribís y las detenés desde el teléfono, y cuando piden permiso lo aprobás o rechazás con un botón. El chat es experimental: escribe en su terminal, así que no manda nada si en la pantalla hay una pregunta abierta. Necesita mars-ram 0.2.0 en la computadora y ejecutar «mars-ram install».",
    "La barra de teclas de la terminal se puede esconder para ganar espacio. En Personalización › Personalizar teclas elegís «Siempre visible», «Autodesplegable» o «Con un toque», y el tamaño de la pestañita.",
   ],
   fixes: [
    "En la terminal, pegar un texto ya no lo repite cada vez que seguís escribiendo.",
    "Enter en la terminal ya no cierra el teclado.",
   ],
  },
  en: {
   new: [
    "Live Claude Code and Codex sessions, like with Pi: you see the conversation, write to them and stop them from the phone, and when they ask for permission you allow or deny it with a button. The chat is experimental: it types into their terminal, so it sends nothing while a question is open on the screen. It needs mars-ram 0.2.0 on the computer and running «mars-ram install».",
    "The terminal key bar can hide to give the terminal more room. In Personalization › Customize keys you choose «Always visible», «Auto-hide» or «One tap», and the size of the small tab.",
   ],
   fixes: [
    "In the terminal, a paste is no longer repeated every time you keep typing.",
    "Enter in the terminal no longer closes the keyboard.",
   ],
  },
 },
 {
  build: 14,
  version: "1.0.0",
  es: {
   new: [
    "El selector de terminales abre en «Agentes», así ves primero qué sesiones te necesitan. En «Espacios», cada espacio muestra en qué computadora está y en qué rama.",
    "En Personalización elegís cómo se ven los subagentes en Inicio: por sesión, un resumen arriba u ocultos. Con «Preview» ves cómo queda cada opción. El idioma ahora también está en Personalización.",
    "Ajustes está más ordenado: arriba lo que usás todos los días y el resto en «Más ajustes».",
   ],
   fixes: [
    "En Windows, con «Siempre atento», ya no aparece la ventana de terminal que se volvía a abrir cada vez que la cerrabas. Necesita mars-ram 0.1.10 en la computadora.",
   ],
  },
  en: {
   new: [
    "The terminal switcher opens on «Agents», so you see first which sessions need you. In «Workspaces», each workspace shows which computer it is on and which branch.",
    "In Personalization you choose how subagents show on Home: per session, a summary on top, or hidden. With «Preview» you see how each option looks. The language is now in Personalization too.",
    "Settings is tidier: the everyday things on top and the rest in «More settings».",
   ],
   fixes: [
    "On Windows, with «Always attentive», the terminal window that came back every time you closed it no longer shows up. It needs mars-ram 0.1.10 on the computer.",
   ],
  },
 },
 {
  build: 13,
  version: "1.0.0",
  es: {
   new: [
    "Un regalo para los primeros testers, que ayudaron a que la app exista: hay easter eggs escondidos. Si te pasaron un código, entrá a Ajustes, tocá varias veces seguidas la versión de la app y escribí el código. Lo que desbloquees lo podés compartir con quien quieras.",
    "En Inicio, cada sesión muestra cuántos subagentes tiene trabajando; al tocar el contador ves cuáles son y si alguno te pregunta algo. Necesita mars-ram 0.1.9 en la computadora y Gentle Shell.",
   ],
   fixes: [],
  },
  en: {
   new: [
    "A gift for the first testers, who helped make the app happen: there are easter eggs hidden inside. If someone gave you a code, open Settings, tap the app version several times in a row and type the code. Whatever you unlock, you can share with anyone you like.",
    "On Home, each session shows how many subagents it has working; tap the counter to see which ones they are and whether any of them is asking you something. It needs mars-ram 0.1.9 on the computer and Gentle Shell.",
   ],
   fixes: [],
  },
 },
 {
  build: 12,
  version: "1.0.0",
  es: {
   new: [
    "Parche de seguridad: si un link de afuera de la app quiere abrir la terminal de una sesión, la app primero te pregunta «¿Abrir la terminal?» y te dice en qué computadora. Si cancelás, no se hace nada en la computadora. Las notificaciones de la propia app abren la terminal directo, como antes.",
    "Si el Herdr de una computadora también muestra los espacios de otras máquinas que tiene guardadas, el selector de espacios lo dice con una línea «Este Herdr también muestra: …». Necesita mars-ram 0.1.8 en la computadora, y mars-ram doctor te explica cómo ocultarlas.",
    "En la computadora, desde mars-ram 0.1.8, mars-ram update termina revisando la instalación con mars-ram doctor. Al pasar a la 0.1.8 ejecutá vos mars-ram doctor una vez; las actualizaciones siguientes lo hacen solas.",
   ],
   fixes: [
    "Al agregar una computadora, Tailscale y ZeroTier aparecen como opciones iguales: con las dos funciona todo.",
    "En Windows, sin permisos de administrador, mars-ram doctor y mars-ram pair te explican qué solo se puede revisar o hacer desde una terminal de administrador, en lugar de mostrar un error confuso.",
   ],
  },
  en: {
   new: [
    "Security fix: if a link from outside the app wants to open a session's terminal, the app first asks «Open the terminal?» and tells you which computer. If you cancel, nothing happens on the computer. The app's own notifications open the terminal directly, as before.",
    "If a computer's Herdr also shows the workspaces of other machines it has saved, the workspace switcher says so in a line «This Herdr also shows: …». It needs mars-ram 0.1.8 on the computer, and mars-ram doctor explains how to hide them.",
    "On the computer, from mars-ram 0.1.8 on, mars-ram update ends by checking the setup with mars-ram doctor. When you move to 0.1.8, run mars-ram doctor yourself once; later updates do it on their own.",
   ],
   fixes: [
    "When adding a computer, Tailscale and ZeroTier show up as equal choices: everything works with both.",
    "On Windows, without administrator rights, mars-ram doctor and mars-ram pair explain what can only be checked or done from an administrator terminal, instead of showing a confusing error.",
   ],
  },
 },
 {
  build: 11,
  version: "1.0.0",
  es: {
   new: [
    "Un recorrido corto te muestra, sobre las pantallas de la app, dónde está cada cosa. Lo repetís cuando quieras desde Ajustes › Acerca de › «Ver tutorial». La primera vez que entrás a algunas pantallas te aparece una sugerencia.",
    "En Inicio, «Abrir terminal» abre Herdr o una terminal común en la compu que elijas.",
    "El QR para conectar una compu es mucho más chico y se escanea más fácil. Lo muestra mars-ram 0.1.7, y para escanearlo necesitás esta versión de la app. Además, la compu detecta sola si usás Tailscale o ZeroTier, y si están los dos te pregunta cuál.",
    "Con mars-ram 0.1.7 en la compu, actualizarla es un solo comando: mars-ram update. La app te lo muestra cuando hay una versión nueva.",
   ],
   fixes: [
    "El botón del teclado en la terminal abre el teclado al primer toque.",
    "Si una compu no responde porque falta prender Tailscale o ZeroTier en el teléfono, la app te dice cuál prender.",
   ],
  },
  en: {
   new: [
    "A short tour shows you, on the app's own screens, where everything is. Repeat it whenever you want from Settings › About › «Show tutorial». The first time you open some screens, a tip appears.",
    "On Home, «Open terminal» opens Herdr or a plain terminal on the computer you choose.",
    "The QR code for connecting a computer is much smaller and easier to scan. mars-ram 0.1.7 shows it, and you need this version of the app to scan it. Also, the computer detects on its own whether you use Tailscale or ZeroTier, and asks which one when both are on.",
    "With mars-ram 0.1.7 on the computer, updating it is a single command: mars-ram update. The app shows it to you when a new version is out.",
   ],
   fixes: [
    "The keyboard button in the terminal opens the keyboard on the first tap.",
    "When a computer doesn't answer because Tailscale or ZeroTier is off on the phone, the app tells you which one to turn on.",
   ],
  },
 },
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
