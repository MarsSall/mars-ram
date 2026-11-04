import { expect, it, vi } from "vitest";
import { HostConnections } from "../src/core/host-connections";
import { KeySecurity, type KeySecurityState } from "../src/core/key-security";
import type { HostConnection } from "../src/core/ports";
import { FakeSsh, failure, savedHost } from "./fakes";

it("resumes a rotation on reconnect after the computer was connected then offline during the toggle", async () => {
 const ssh = new FakeSsh();
 ssh.readFile = async () => ({ ok: true, content: JSON.stringify({ node: "/usr/bin/node", cli: "/opt/mars/main.ts" }) });
 const host = ssh as unknown as HostConnection;
 host.exec = async (_id, command) => ({ ok: true, stdout: command.includes(" key add ") ? '{"added":true}' : command.includes(" key remove ") ? '{"removed":1}' : command === "echo key-rotation-proof" ? "key-rotation-proof" : "", stderr: "", exitStatus: 0 });
 let saved = savedHost("a", { keyAlias: "app-ssh-key", rotation: { phase: "done" } });
 let state: KeySecurityState | null = null;
 const catalog = { list: async () => [saved], save: async (value: typeof saved) => { saved = value; }, remove: async () => {} };
 const deleteKey = vi.fn(async () => {});
 const security = new KeySecurity({ host, catalog, store: { read: async () => state, write: async value => { state = value; } },
  credentials: { ensureKey: async alias => ({ publicKey: alias === "app-ssh-key" ? "ssh-ed25519 AAAA" : "ssh-ed25519 BBBB" }), deleteKey, unlock: async () => true } });
 const connections = new HostConnections({ host, catalog, keyAlias: "app-ssh-key", unlock: async () => true, afterConnect: () => security.resume() });
 await connections.connection(saved);
 await new Promise(resolve => setTimeout(resolve, 0));
 await connections.drop("a"); ssh.refuse = failure("UNREACHABLE");
 await security.setRequireUnlock(false);
 expect(saved.rotation?.phase).toBe("pending"); expect(deleteKey).not.toHaveBeenCalled();
 ssh.refuse = null;
 await connections.connection(saved);
 await new Promise(resolve => setTimeout(resolve, 0));
 expect(saved.rotation?.phase).toBe("done"); expect(saved.keyAlias).toBe("app-ssh-key-1");
 expect(deleteKey).toHaveBeenCalledWith("app-ssh-key");
});
