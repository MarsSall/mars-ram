// The command runs with Node's own TypeScript support, which only strips types. Vitest compiles
// differently, so this runs the real entry point to catch syntax Node rejects.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const main = join(import.meta.dirname, "..", "..", "src", "main.ts");

describe("node entry point", () => {
	it("runs the real doctor with strip-only Node and reports problems instead of usage", async () => {
		const home = join(import.meta.dirname, "fixtures", "doctor-no-home");
		const result = await promisify(execFile)(process.execPath, [main, "doctor"], { env: { ...process.env, HOME: home, USERPROFILE: home, PATH: "", LANG: "en_US.UTF-8", LC_ALL: "" }, timeout: 20_000 }).catch((error: { code: number; stdout: string; stderr: string }) => error);
		expect(result).toMatchObject({ code: 1 });
		expect(result.stdout).toContain("problem: Pi");
		expect(result.stdout).toContain("Link-server copy missing or outdated");
		expect(result.stdout).toContain("Tailscale");
		expect(result.stderr).not.toMatch(/SyntaxError|Usage:/);
		expect(result.stdout.trim().split(/\r?\n/).every((line) => /^(ok|warning|problem): /.test(line))).toBe(true);
	});
	it("loads every module and prints the usage for an unknown command", async () => {
		const result = await promisify(execFile)(process.execPath, [main, "no-such-command"]).catch((error: { code: number; stderr: string }) => error);
		expect(result).toMatchObject({ code: 2 });
		expect((result as { stderr: string }).stderr).not.toContain("SyntaxError");
		expect((result as { stderr: string }).stderr).toMatch(/pair/);
	});
});

describe.skipIf(process.platform === "win32")("install Herdr record through the real Node entry (fake Pi only)", () => {
 it.each([false, true])("installs the bridge with Herdr present=%s without running real Pi or Herdr", async present => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, realpathSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const home = mkdtempSync(join(tmpdir(), "mr-herdr-entry-"));
  try {
   mkdirSync(join(home, ".pi/agent"), { recursive: true });
   const bin = join(home, "bin"); mkdirSync(bin);
   const pi = join(bin, "pi"); writeFileSync(pi, "#!/bin/sh\nexit 0\n"); chmodSync(pi, 0o700);
   const herdr = join(bin, "herdr");
   if (present) { writeFileSync(herdr, "not a program: lookup must never execute this\n"); chmodSync(herdr, 0o700); }
   const run = promisify(execFile)(process.execPath, [main, "install"], { env: { ...process.env, HOME: home, USERPROFILE: home, PATH: bin, LANG: "en_US.UTF-8", LC_ALL: "" }, timeout: 20_000 });
   run.child.stdin?.end("\ny\n"); const { stdout } = await run;
   expect(JSON.parse(readFileSync(join(home, ".mars-ram/host.json"), "utf8"))).toEqual({ ...(present ? { herdr } : {}), programs: { pi: realpathSync(pi) }, node: process.execPath, cli: join(home, '.mars-ram/cli/src/main.ts'), linkServer: join(home, ".mars-ram/link-server/src/main.ts"), linkPort: 47811 });
   expect(JSON.parse(readFileSync(join(home, ".mars-ram/install.json"), "utf8")).homes).toEqual([join(home, ".pi/agent")]);
   expect(stdout.includes("terminal will not open")).toBe(!present);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
});

const hasPi = await promisify(execFile)(process.platform === "win32" ? "where" : "which", ["pi"]).then(() => true, () => false);

describe.skipIf(!hasPi)("install answers typed ahead", () => {
	it("reads both answers when they arrive together, and a no changes nothing", async () => {
		const { mkdtempSync, mkdirSync, readdirSync, rmSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const home = mkdtempSync(join(tmpdir(), "mr-cli-home-"));
		try {
			mkdirSync(join(home, ".pi", "agent"), { recursive: true });
			const run = promisify(execFile)(process.execPath, [main, "install"], { env: { ...process.env, HOME: home, USERPROFILE: home, VOLTA_HOME: process.env.VOLTA_HOME ?? join(homedir(), ".volta"), LANG: "en_US.UTF-8", LC_ALL: "" }, timeout: 20_000 });
			run.child.stdin?.end("\nn\n");
			const { stdout } = await run;
			expect(stdout).toContain("Install or update the bridge in these environments? [y/N]");
			expect(stdout).toMatch(/cancel/i);
			expect(readdirSync(join(home, ".pi", "agent"))).toEqual([]);
			expect(readdirSync(home)).not.toContain(".mars-ram");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	}, 30_000);
});

describe("doctor in Spanish", () => {
	it("labels every line in Spanish", async () => {
		const result = await promisify(execFile)(process.execPath, [main, "doctor"], { env: { ...process.env, HOME: join(import.meta.dirname, "fixtures", "doctor-no-home"), USERPROFILE: join(import.meta.dirname, "fixtures", "doctor-no-home"), PATH: "", LANG: "es_AR.UTF-8", LC_ALL: "" }, timeout: 30_000 }).catch((error: { stdout: string }) => error);
		const lines = (result as { stdout: string }).stdout.trim().split("\n");
		expect(lines.length).toBeGreaterThan(3);
		for (const line of lines) expect(line).toMatch(/^(ok|aviso|problema): /);
	}, 40_000);
});
