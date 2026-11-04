import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE = resolve(import.meta.dirname, "fixtures/ask-confirmation.ts");

/** Runs the fixture in a pseudo-terminal with `script`, typing `keys` once the question shows. */
function runInTerminal(keys: string): Promise<string> {
	return new Promise((done, fail) => {
		const child = spawn("script", ["-qec", `node ${FIXTURE}`, "/dev/null"], { stdio: ["pipe", "pipe", "pipe"] });
		let output = "";
		let typed = false;
		// The child may exit while a write is in flight; that is not a test failure.
		child.stdin.on("error", () => {});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			fail(new Error(`No result within 20 s; output: ${JSON.stringify(output)}`));
		}, 20_000);
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			// Type once: a second Ctrl+C after readline restored cooked mode is a SIGINT that
			// kills the fixture before it prints RESULT.
			if (!typed && output.includes("Authorize?")) { typed = true; child.stdin.write(keys); }
			if (output.includes("RESULT")) {
				clearTimeout(timer);
				child.kill();
				done(output);
			}
		});
	});
}

// `script` is util-linux; the Windows console handles Ctrl+C differently and is checked by hand.
describe.runIf(process.platform === "linux")("confirmation question in a terminal", { timeout: 30_000 }, () => {
	it("treats Ctrl+C as a refusal and cancels pairing", async () => {
		expect(await runInTerminal("\u0003")).toContain("RESULT answer=false cancelled=true");
	});

	it("authorizes only on an explicit yes", async () => {
		expect(await runInTerminal("s\r")).toContain("RESULT answer=true cancelled=false");
	});

	it("refuses on a bare Enter", async () => {
		expect(await runInTerminal("\r")).toContain("RESULT answer=false cancelled=false");
	});
});
