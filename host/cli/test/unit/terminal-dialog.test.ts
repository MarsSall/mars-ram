import { describe, expect, it } from "vitest";
import { terminalDialogOpen } from "../../src/core/terminal-dialog.ts";

const ESC = "\u001b";
const bold = (text: string) => `${ESC}[1m${text}${ESC}[0m`;
const cyan = (text: string) => `${ESC}[38;2;0;190;255m${text}${ESC}[39m`;
const dim = (text: string) => `${ESC}[2m${text}${ESC}[22m`;
const screen = (...lines: string[]) => lines.join("\r\n");
/** Lines that scroll a past dialog out of the bottom of the screen. */
const filler = (count: number) => Array.from({ length: count }, (_, i) => `⏺ Line ${i + 1} of the later answer.`);

const claudeIdle = [
	"",
	"⏺ Done: the file /tmp/prueba.txt is created.",
	"",
	"────────────────────────────────────────────────────────────────────────",
	"❯ ",
	"────────────────────────────────────────────────────────────────────────",
	dim("  ? for shortcuts"),
];

const codexIdle = [
	"",
	`${ESC}[1m•${ESC}[0m Created /tmp/prueba.txt.`,
	"",
	`${cyan("›")} Ask Codex to do anything`,
	"",
	dim("  100% context left · ? for shortcuts"),
];

describe("terminalDialogOpen: Claude Code", () => {
	it("sees a Bash permission dialog in its box", () => {
		expect(terminalDialogOpen(screen(
			"⏺ I'll create the test file.",
			"",
			"⏺ Bash(touch /tmp/prueba.txt)",
			"  ⎿  Running…",
			"",
			"╭──────────────────────────────────────────────────────────────────╮",
			`│ ${bold("Bash command")}                                                     │`,
			"│                                                                  │",
			"│   touch /tmp/prueba.txt                                          │",
			"│   Create an empty test file                                      │",
			"│                                                                  │",
			"│ Do you want to proceed?                                          │",
			`│ ${cyan("❯")} ${cyan("1. Yes")}                                                         │`,
			"│   2. Yes, and don't ask again for touch commands in /tmp         │",
			"│   3. No, and tell Claude what to do differently (esc)            │",
			"╰──────────────────────────────────────────────────────────────────╯",
		))).toBe(true);
	});

	it("sees an edit dialog with an Esc to cancel footer and no box", () => {
		expect(terminalDialogOpen(screen(
			"⏺ Update(notes.md)",
			"",
			"────────────────────────────────────────────────────────────────────",
			" Edit file",
			" notes.md",
			"╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
			" 1   # Notes",
			" 2 - old line",
			" 2 + new line",
			"╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
			" Do you want to make this edit to notes.md?",
			" ❯ 1. Yes",
			"   2. Yes, allow all edits during this session (shift+tab)",
			"   3. No, and tell Claude what to do differently (esc)",
			"",
			dim(" Esc to cancel · Tab to amend"),
		))).toBe(true);
	});

	it("sees a question with only its Esc to cancel footer in view", () => {
		expect(terminalDialogOpen(screen(" Do you want to create prueba.txt?", "   Yes", "   No", "", " Esc to cancel"))).toBe(true);
	});

	it("sees a selection menu whose cursor is on a later option", () => {
		expect(terminalDialogOpen(screen(
			" Do you trust the files in this folder?",
			"",
			"   1. Yes, proceed",
			` ${cyan("❯ 2. No, exit")}`,
			"",
			" Enter to confirm · Esc to exit",
		))).toBe(true);
	});
});

describe("terminalDialogOpen: Codex", () => {
	it("sees the command approval overlay", () => {
		expect(terminalDialogOpen(screen(
			"• Running touch /tmp/prueba.txt",
			"",
			"▌",
			`▌ ${bold("Would you like to run the following command?")}`,
			"▌",
			"▌ Reason: create the test file outside the workspace",
			"▌",
			"▌ $ touch /tmp/prueba.txt",
			"▌",
			`▌ ${cyan("› 1. Yes, proceed (y)")}`,
			"▌   2. Yes, and don't ask again for this command (p)",
			"▌   3. No, and tell Codex what to do differently (esc)",
			"",
			dim("  Press enter to confirm or esc to cancel"),
		))).toBe(true);
	});

	it("sees the edits overlay with a tall diff pushing its question out of the bottom", () => {
		expect(terminalDialogOpen(screen(
			"  Would you like to make the following edits?",
			...Array.from({ length: 30 }, (_, i) => `  ${i + 1} + added line ${i + 1}`),
			"› 1. Yes, proceed (y)",
			"  2. Yes, and don't ask again for these files (a)",
			"  3. No, and tell Codex what to do differently (esc)",
			"",
			"  Press enter to confirm or esc to cancel",
		))).toBe(true);
	});

	it("sees the network access overlay", () => {
		expect(terminalDialogOpen(screen(
			'  Do you want to approve network access to "registry.npmjs.org"?',
			"",
			"› Allow and proceed",
			"  Deny",
		))).toBe(true);
	});

	it("sees the footer alone and the question alone", () => {
		expect(terminalDialogOpen(screen(...codexIdle.slice(0, 2), "  Press enter to confirm or esc to cancel"))).toBe(true);
		expect(terminalDialogOpen(screen("  Would you like to run the following command?", "", "  $ rm -rf build"))).toBe(true);
	});
});

describe("terminalDialogOpen: no dialog", () => {
	it("an empty or blank screen", () => {
		expect(terminalDialogOpen("")).toBe(false);
		expect(terminalDialogOpen(screen("", "   ", `${ESC}[0m`))).toBe(false);
	});

	it("Claude Code's idle prompt, also with a draft typed", () => {
		expect(terminalDialogOpen(screen(...claudeIdle))).toBe(false);
		expect(terminalDialogOpen(screen(...claudeIdle.slice(0, 4), "❯ hola, seguí con el paso 2", ...claudeIdle.slice(5)))).toBe(false);
		expect(terminalDialogOpen(screen("╭────────────────────╮", "│ >                  │", "╰────────────────────╯", "  ? for shortcuts"))).toBe(false);
	});

	it("Codex's idle composer", () => {
		expect(terminalDialogOpen(screen(...codexIdle))).toBe(false);
	});

	it("a past dialog scrolled above the bottom of the screen", () => {
		expect(terminalDialogOpen(screen(
			" Do you want to proceed?",
			" ❯ 1. Yes",
			"   2. No, and tell Claude what to do differently (esc)",
			" Esc to cancel",
			"  Would you like to run the following command?",
			"› 1. Yes, proceed (y)",
			"  2. No (esc)",
			"  Press enter to confirm or esc to cancel",
			...filler(25),
			...claudeIdle,
		))).toBe(false);
	});

	it("a past assistant message with «1. Yes» in it", () => {
		expect(terminalDialogOpen(screen(
			"⏺ When Claude asked I picked:",
			"  1. Yes",
			"  2. Yes, and don't ask again",
			"  and the file was created.",
			...claudeIdle,
		))).toBe(false);
	});

	it("a numbered list and a question in the answer above the input box", () => {
		expect(terminalDialogOpen(screen(
			"⏺ Here is the plan:",
			"",
			"  1. Yes, install the dependency",
			"  2. Run the tests",
			"  3. Commit",
			"",
			"  Do you want to proceed?",
			...claudeIdle,
		))).toBe(false);
		expect(terminalDialogOpen(screen("• Steps:", "  1. Build", "  2. Test", ...codexIdle))).toBe(false);
	});
});
