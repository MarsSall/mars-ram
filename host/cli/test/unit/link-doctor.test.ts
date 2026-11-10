import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createInstallAdapter, stableNodePath } from "../../src/adapters/installation.ts";
import { linkCopyIsCurrent } from "../../src/adapters/link-installation.ts";
import { observeLinkServer } from "../../src/adapters/link-doctor.ts";

describe("read-only link diagnostics in a temporary home", () => {
 it("uses non-mutating status only from a configured current copy", async () => {
  const home = mkdtempSync(join(tmpdir(), "link-doctor-"));
  try {
   const root = join(home, ".mars-ram"), store = join(root, "links");
   const adapter = createInstallAdapter({ home, herdr: () => undefined });
   expect(await observeLinkServer(root)).toEqual({ present: false, current: false, configured: false, validLinks: 0, listener: false });
   await adapter.buildCopy(); await adapter.writeHostConfig();
   expect(linkCopyIsCurrent(join(root, "link-server"))).toBe(true);
   const command = await promisify(execFile)(process.execPath, [join(root, "link-server/src/main.ts"), "list"], { env: { ...process.env, HOME: home, USERPROFILE: home, PATH: "" }, timeout: 10000 });
   expect(JSON.parse(command.stdout)).toEqual({ serving: false, links: [] });
   expect(command.stderr).toBe("");
   mkdirSync(store, { recursive: true });
   for (const [id, expiresAt] of [["abcdefghijkl", "2030-01-02T00:00:00Z"], ["mnopqrstuvwx", "2029-12-31T00:00:00Z"]]) {
    mkdirSync(join(store, id!)); writeFileSync(join(store, id!, "link.json"), JSON.stringify({ id, expiresAt }));
   }
   const record = { pid: 123, instance: "a".repeat(22), startedAt: "2029-12-31T00:00:00Z", ip: "100.64.0.1", port: 47811 };
   const path = join(store, "server.pid.json"); writeFileSync(path, JSON.stringify(record));
   const before = readFileSync(join(store, "mnopqrstuvwx/link.json"), "utf8");
   const probes: unknown[] = [];
   const options = { now: Date.parse("2030-01-01T00:00:00Z"), status: async (node: string, main: string, home: string) => { probes.push([node, main, home]); return { serving: true, links: 1 }; } };
   expect(await observeLinkServer(root, options)).toEqual({ present: true, current: true, configured: true, validLinks: 1, listener: true });
   expect(probes).toEqual([[stableNodePath(), join(root, "link-server/src/main.ts"), home]]);
   expect(readFileSync(join(store, "mnopqrstuvwx/link.json"), "utf8")).toBe(before);
   expect((await observeLinkServer(root, { ...options, status: async () => ({ serving: false, links: 1 }) })).listener).toBe(false);
   // Per network: which listeners serve and which networks have «Siempre atento» registrations (zerotier-phase2 S4).
   const networks = { listeners: { tailscale: false, zerotier: ["10.147.20.49"] }, notify: { tailscale: true, zerotier: ["10.147.20.49", "10.147.20.50"] } };
   const asked: unknown[] = []; const quiet = { now: options.now, status: async () => ({ serving: true, links: 1 }) };
   const ask = (value: unknown) => async (node: string, main: string, home: string) => { asked.push([node, main, home]); return value as never; };
   // Asked only when registrations exist; their contents (phones, secrets) are never read here.
   expect(await observeLinkServer(root, { ...quiet, networks: ask(networks) })).not.toHaveProperty("listeners");
   expect(asked).toEqual([]);
   mkdirSync(join(root, "notify")); writeFileSync(join(root, "notify", `${"a".repeat(64)}.json`), "not read");
   expect(await observeLinkServer(root, { ...quiet, networks: ask(networks) })).toMatchObject({ listener: true, notificationsRegistered: true, listeners: networks.listeners, notifyNetworks: networks.notify });
   expect(asked).toEqual([[stableNodePath(), join(root, "link-server/src/main.ts"), home]]);
   for (const bad of [{ ...networks, listeners: { tailscale: "yes", zerotier: [] } }, { ...networks, notify: { tailscale: true, zerotier: ["../x"] } }, { ...networks, listeners: { tailscale: true, zerotier: "10.1.1.1" } }, null]) {
    const observed = await observeLinkServer(root, { ...quiet, networks: ask(bad) });
    expect(observed.listeners).toBeUndefined(); expect(observed.notifyNetworks).toBeUndefined();
   }
   const failing = await observeLinkServer(root, { ...quiet, networks: async () => { throw new Error("old copy"); } });
   expect(failing).toMatchObject({ listener: true, notificationsRegistered: true }); expect(failing.listeners).toBeUndefined();
   writeFileSync(join(root, "link-server/src/main.ts"), "// old");
   expect((await observeLinkServer(root, options)).current).toBe(false);
   writeFileSync(join(root, "host.json"), JSON.stringify({ node: "node", linkServer: "relative", linkPort: 1 }));
   expect((await observeLinkServer(root, options)).configured).toBe(false);
   expect(probes).toHaveLength(1);
  } finally { rmSync(home, { recursive: true, force: true }); }
 });
});
