// Whether an agent's own permission or selection dialog is open in its terminal, read from the pane's visible
// screen (Herdr `pane read --format ansi`). A phone message must not be typed into such a dialog: Enter would pick
// one of its options. Pure text matching on what Claude Code and Codex draw; no I/O.
//
// Only the bottom of the screen counts: dialogs are drawn at the bottom, above nothing but their footer, while the
// conversation above (a past dialog, an answer quoting one, a numbered list) may contain the same words. Errs on the
// side of «open»: a false positive only refuses one phone message, a false negative may answer a dialog.

/** How many non-empty lines, counted from the bottom, are looked at. */
const BOTTOM_LINES = 20;

/** CSI and OSC sequences, then any other escape pair, then remaining control characters (newlines kept). */
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;
/** Box drawing (U+2500–U+257F) and block elements (U+2580–U+259F): borders, rules and gutters. */
const BORDERS = /[\u2500-\u259f]/g;

/** Claude Code: «Do you want to proceed?», «Do you want to make this edit to x?», «Do you want to create x?». */
const CLAUDE_QUESTION = /\bDo you want to\b.*\?/i;
const CLAUDE_FOOTER = /\bEsc to cancel\b/i;
/** Codex (codex-rs tui approval overlay): command, edits and network approvals. */
const CODEX_QUESTION = /\bWould you like to (?:run the following command|make the following edits)\?|\bDo you want to approve network access\b/i;
const CODEX_FOOTER = /\bPress enter to confirm or esc to cancel\b/i;
/** The option under the cursor of a selection list: «❯ 1. Yes» (Claude Code), «› 1. Yes, proceed (y)» (Codex). */
const CURSOR_OPTION = /^[❯›]\s*\d+\.\s+\S/;
/** Any numbered option line, under the cursor or not. */
const OPTION = /^(?:[❯›]\s*)?\d+\.\s+\S/;

/** The screen's bottom non-empty lines, without escape sequences, borders or surrounding blanks. */
export function bottomLines(screen: string): string[] {
	return screen
		.replace(/\r\n?/g, "\n")
		.replace(ANSI, "")
		.replace(BORDERS, " ")
		.replace(/\u00a0/g, " ")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.slice(-BOTTOM_LINES);
}

export function terminalDialogOpen(screen: string): boolean {
	const lines = bottomLines(screen);
	const any = (pattern: RegExp) => lines.some((line) => pattern.test(line));
	if (any(CODEX_QUESTION) || any(CODEX_FOOTER)) return true;
	const cursor = lines.findIndex((line) => CURSOR_OPTION.test(line));
	// A question of Claude Code's with its cursor option or its footer.
	if (any(CLAUDE_QUESTION) && (cursor !== -1 || any(CLAUDE_FOOTER))) return true;
	// Any selection menu: a numbered option under the cursor next to another numbered option, so Enter picks one.
	return cursor !== -1 && lines.some((line, index) => index !== cursor && OPTION.test(line));
}
