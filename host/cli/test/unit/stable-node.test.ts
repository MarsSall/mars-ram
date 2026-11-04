import { afterEach, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableNodePath } from "../../src/adapters/installation.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function layout() {
 const root = mkdtempSync(join(tmpdir(), "mr-node-")); dirs.push(root);
 const store = join(root, "store"); const real = join(store, "abc-nodejs/bin/node");
 mkdirSync(join(store, "abc-nodejs/bin"), { recursive: true }); writeFileSync(real, ""); chmodSync(real, 0o755);
 const profile = join(root, "profile/bin"); mkdirSync(profile, { recursive: true }); symlinkSync(real, join(profile, "node"));
 const other = join(root, "other/bin"); mkdirSync(other, { recursive: true }); writeFileSync(join(other, "node"), ""); chmodSync(join(other, "node"), 0o755);
 return { store: `${store}/`, real, profile, other };
}
it("keeps a store-resolved node on a stable PATH symlink to the same file", () => {
 const l = layout();
 expect(stableNodePath({ execPath: l.real, path: [l.other, l.profile].join(":"), storePrefix: l.store })).toBe(join(l.profile, "node"));
});
it("keeps execPath when no PATH entry resolves to it or it is outside the store", () => {
 const l = layout();
 expect(stableNodePath({ execPath: l.real, path: l.other, storePrefix: l.store })).toBe(l.real);
 expect(stableNodePath({ execPath: join(l.other, "node"), path: l.profile, storePrefix: l.store })).toBe(join(l.other, "node"));
});
