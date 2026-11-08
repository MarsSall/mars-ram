// What changed in each release, in plain words, bundled with the app.
// Every release adds one entry keyed by its Android versionCode (see the
// release-and-distribution skill). Keep both languages with the same items.

export type ReleaseNoteText = { new: string[]; fixes: string[] };
export type ReleaseNote = { build: number; version: string; es: ReleaseNoteText; en: ReleaseNoteText };

export const RELEASE_NOTES: ReleaseNote[] = [
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
