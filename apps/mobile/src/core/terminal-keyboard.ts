// Android shows the soft keyboard for a WebView only after a touch inside the page:
// a programmatic WebView focus never opens it. The key bar's button therefore opens it
// on a hidden native input (its focus calls showSoftInput) and that input stays the
// keyboard target: its text and keys are sent to the terminal. Focus is never handed
// to the WebView after a button open (terminal-keyboard-first-press L4).
//
// "Open?" is read from the real state on every press: the hidden input being focused,
// or RN's last-known keyboard visibility. keyboardDidShow can be missed (biometric
// prompt, app in background), so the toggle never depends on it alone.

/** How long a terminal tap may take to move native focus off the hidden input. */
export const TAP_SETTLE_MS = 150;

export type TerminalKeyboardPorts = {
 /** The hidden input owns focus (TextInput.isFocused()). */
 proxyFocused(): boolean;
 /** RN's last-known keyboard visibility (Keyboard.isVisible()). */
 keyboardVisible(): boolean;
 /** Focus the hidden input; Android shows the soft keyboard for it. */
 focusProxy(): void;
 /** Blur the hidden input; Android hides the soft keyboard. */
 blurProxy(): void;
 dismiss(): void;
 /** Focus xterm in the page (no keyboard of its own on Android). */
 focusTerminal(): void;
};

export function terminalKeyboard(ports: TerminalKeyboardPorts) {
 let ready = false; let queued = false;
 let timer: ReturnType<typeof setTimeout> | null = null;
 const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
 const isOpen = () => ports.proxyFocused() || ports.keyboardVisible();
 const releaseProxy = () => { if (ports.proxyFocused()) ports.blurProxy(); };
 return {
  isOpen,
  /** The key bar button. Returns whether the keyboard is now open. */
  press(): boolean {
   clearTimer(); queued = false;
   if (isOpen()) { releaseProxy(); ports.dismiss(); return false; }
   ports.focusProxy();
   return true;
  },
  /** Focus the terminal without opening the keyboard (PREFIX, project paste). */
  focus() {
   if (ports.proxyFocused()) return; // the hidden input already types into the terminal
   if (ready) ports.focusTerminal(); else queued = true;
  },
  pageReady(value: boolean) {
   ready = value;
   if (ready && queued) { queued = false; if (!ports.proxyFocused()) ports.focusTerminal(); }
  },
  /** The keyboard was hidden (system Back): the hidden input must not stay focused. */
  keyboardHidden: releaseProxy,
  /** The terminal was tapped: xterm owns the keyboard, so the hidden input lets go. */
  terminalTapped() {
   clearTimer();
   if (!ports.proxyFocused()) return;
   timer = setTimeout(() => { timer = null; releaseProxy(); }, TAP_SETTLE_MS);
  },
  /** The terminal was blurred (switcher, chat, project sheet). */
  release() { clearTimer(); queued = false; releaseProxy(); },
  dispose() { clearTimer(); queued = false; },
 };
}

/** Keys the hidden input reports without a text change. */
export function proxyKeyBytes(key: string): Uint8Array | null {
 return key === "Backspace" ? new Uint8Array([0x7f]) : key === "Enter" ? new Uint8Array([0x0d]) : null;
}

/** Text typed into the hidden input, as terminal bytes (a newline is Enter). */
export function proxyTextBytes(text: string): Uint8Array {
 return new TextEncoder().encode(text.replace(/\r?\n/g, "\r"));
}

export type ProxyInputPorts = {
 send(bytes: Uint8Array): void;
};

/**
 * The hidden input's events, as terminal bytes, sending each edit once.
 *
 * The input is never cleared while it is focused: on Android, TextInput.clear() from
 * inside onChangeText carries the event count of the previous render and
 * ReactEditText drops it as stale, so the native text kept growing and every key
 * resent the whole buffer (a paste, then each later key, repeated the paste).
 * Each change is instead diffed against the last native text: removed characters
 * are DEL, added ones are text (a "\n", which is how the multiline input receives
 * Enter, becomes CR). The screen recreates the input empty on blur and calls reset().
 */
export function proxyInput(ports: ProxyInputPorts) {
 let last = "";
 return {
  change(text: string) {
   const max = Math.min(last.length, text.length);
   let same = 0;
   while (same < max && last.charCodeAt(same) === text.charCodeAt(same)) same++;
   // Never split a surrogate pair (emoji) between the kept and the edited part.
   if (same > 0 && isHighSurrogate(last.charCodeAt(same - 1))) same--;
   const removed = Array.from(last.slice(same)).length;
   const added = text.slice(same);
   last = text;
   if (removed) ports.send(new Uint8Array(removed).fill(0x7f));
   if (added) ports.send(proxyTextBytes(added));
  },
  /** onKeyPress (fires before the change). Backspace only reaches the terminal here when the input has nothing to delete. */
  key(key: string) { if (key === "Backspace" && !last) ports.send(proxyKeyBytes("Backspace")!); },
  /** The native input was recreated empty. */
  reset() { last = ""; },
 };
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
