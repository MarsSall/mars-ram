import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createDoctorAdapter } from "../../src/adapters/doctor.ts";
import { checkHerdr } from "../../src/core/doctor.ts";
it("doctor checks the recorded executable without running it and warns for missing, moved or invalid Herdr", async () => {
 const home = mkdtempSync(join(tmpdir(), "herdr-doctor-"));
 try {
  mkdirSync(join(home, ".mars-ram"));
  const adapter = { ...createDoctorAdapter({ home }), spanish: false };
  for (const content of [undefined, "bad json", "{}", JSON.stringify({ herdr: join(home, "herdr") }), JSON.stringify({ herdr: join(home, "bash") })]) {
   if (content !== undefined) writeFileSync(join(home, ".mars-ram/host.json"), content);
   expect(await checkHerdr(adapter)).toMatchObject([{ status: "warning", fix: expect.stringMatching(/run mars-ram install again/i) }]);
  }
  const herdr = join(home, "herdr"); writeFileSync(herdr, "never execute"); chmodSync(herdr, 0o700);
  writeFileSync(join(home, ".mars-ram/host.json"), JSON.stringify({ herdr }));
  expect(await checkHerdr(adapter)).toMatchObject([{ status: "ok" }]);
  chmodSync(herdr, 0o600);
  expect(await checkHerdr(adapter)).toMatchObject([{ status: "warning" }]);
 } finally { rmSync(home, { recursive: true, force: true }); }
});
