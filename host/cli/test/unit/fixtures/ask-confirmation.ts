// Runs the confirmation question in a real terminal for the Ctrl+C test.
import { askConfirmation } from "../../../src/adapters/terminal.ts";

let cancelled = false;
const answer = await askConfirmation("Authorize? [y/N] ", () => {
	cancelled = true;
});
console.log(`RESULT answer=${answer} cancelled=${cancelled}`);
process.exit(0);
