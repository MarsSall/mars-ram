import { afterEach, describe, expect, it, vi } from "vitest";
import { HostConnections } from "../src/core/host-connections";
import type { HostConnection } from "../src/core/ports";
import { failure, FakeSsh, savedHost } from "./fakes";

function setup() {
	const ssh = new FakeSsh();
	const unlocks = { count: 0, answer: true };
	const connections = new HostConnections({
		host: ssh as unknown as HostConnection,
		keyAlias: "app-key",
		unlock: async () => {
			unlocks.count++;
			if (unlocks.answer) ssh.locked = false;
			return unlocks.answer;
		},
	});
	return { ssh, unlocks, connections };
}

afterEach(() => vi.useRealTimers());
describe("HostConnections pending-attempt recovery", () => {
 it("releases a native attempt stuck after successful unlock for all callers, and ignores its late success", async () => {
  vi.useFakeTimers(); const ssh = new FakeSsh();
  let calls = 0; let late!: (result: { ok: true; connectionId: string; fingerprint: string; address: string }) => void;
  const nativeConnect = ssh.connect.bind(ssh); const connected = vi.fn();
  ssh.connect = async target => {
   calls++;
   if (calls === 1) return failure("UNLOCK_REQUIRED");
   if (calls === 2) return new Promise(resolve => { late = resolve; });
   return nativeConnect(target);
  };
  const unlock = vi.fn(async () => true);
  const pool = new HostConnections({ host: ssh as unknown as HostConnection, keyAlias: "key", unlock, onConnected: connected });
  let settled: unknown;
  const home = pool.connection(savedHost("a")).then(result => { settled = result; return result; });
  const watch = pool.connection(savedHost("a"));
  await vi.advanceTimersByTimeAsync(0); expect(unlock).toHaveBeenCalledOnce(); expect(calls).toBe(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(settled).toMatchObject({ ok: false, code: "TIMEOUT" });
  expect(await home).toEqual(await watch);
  const retry = await pool.connection(savedHost("a")); expect(retry).toMatchObject({ ok: true }); expect(calls).toBe(3);
  late({ ok: true, connectionId: "late", fingerprint: "pin", address: "100.64.0.1" }); await vi.advanceTimersByTimeAsync(0);
  expect(ssh.disconnected).toContain("late"); expect(connected).toHaveBeenCalledTimes(1);
  expect(await pool.connection(savedHost("a"))).toEqual(retry);
 }, 1000);
 it.each(["never", "reject"] as const)("does not poison the shared unlock gate when it will %s", async mode => {
  vi.useFakeTimers(); const ssh = new FakeSsh(); ssh.locked = true;
  let calls = 0;
  const unlock = async () => {
   if (++calls === 1) { if (mode === "reject") throw Error("Activity lost"); return new Promise<boolean>(() => {}); }
   ssh.locked = false; return true;
  };
  const pool = new HostConnections({ host: ssh as unknown as HostConnection, keyAlias: "key", unlock });
  let settled = false;
  const first = pool.connection(savedHost("a")).catch(() => undefined).then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(settled).toBe(true); await first;
  expect(await pool.connection(savedHost("a"))).toMatchObject({ ok: true }); expect(calls).toBe(2);
 }, 1000);
});
describe("HostConnections", () => {
 it('observes each fresh connection for version checks even while credential maintenance is pending', async () => {
  const ssh = new FakeSsh(), observed: string[] = [];
  const connections = new HostConnections({ host: ssh as unknown as HostConnection, keyAlias: 'key', unlock: async () => true,
   afterConnect: async () => { await new Promise<void>(() => {}); },
   onConnected: async (_computer, id) => { observed.push(id); throw Error('optional probe failed'); },
  });
  await connections.connection(savedHost('a'));
  await connections.connection(savedHost('a'));
  await connections.drop('a');
  expect((await connections.connection(savedHost('a'))).ok).toBe(true);
  expect(observed).toEqual(['conn-1', 'conn-2']);
 });
	it("reloads a rotated alias even when the caller retained an old host snapshot", async () => {
		const ssh = new FakeSsh();
		const stale = savedHost("a", { keyAlias: "app-ssh-key" });
		let current = stale;
		const connections = new HostConnections({ host: ssh as unknown as HostConnection, keyAlias: "fallback", unlock: async () => true, catalog: { list: async () => [current] } });
		await connections.connection(stale);
		current = { ...stale, keyAlias: "app-ssh-key-1" };
		await connections.connection(stale);
		expect(ssh.connects.map(t => t.keyAlias)).toEqual(["app-ssh-key", "app-ssh-key-1"]);
		expect(ssh.disconnected).toEqual(["conn-1"]);
	});

	it("deduplicates running resume hooks after success without blocking SSH", async () => {
		const ssh = new FakeSsh(); let calls = 0;
		const connections = new HostConnections({ host: ssh as unknown as HostConnection, keyAlias: "key", unlock: async () => true,
			afterConnect: async () => { calls++; await new Promise<void>(() => {}); },
		});
		ssh.refuse = failure("UNREACHABLE");
		expect((await connections.connection(savedHost("a"))).ok).toBe(false);
		expect(calls).toBe(0);
		ssh.refuse = null;
		expect((await connections.connection(savedHost("a"))).ok).toBe(true);
		await connections.drop("a");
		await connections.connection(savedHost("a"));
		await connections.connection(savedHost("b"));
		expect(calls).toBe(2);
	});
	it("runs resume again on every fresh connection after the previous hook finishes", async () => {
		const ssh = new FakeSsh(); let calls = 0;
		const connections = new HostConnections({ host: ssh as unknown as HostConnection, keyAlias: "key", unlock: async () => true,
			afterConnect: async () => { calls++; },
		});
		await connections.connection(savedHost("a"));
		await new Promise(resolve => setTimeout(resolve, 0));
		await connections.connection(savedHost("a"));
		expect(calls).toBe(1);
		await connections.drop("a");
		await connections.connection(savedHost("a"));
		expect(calls).toBe(2);
	});
	it("connects once and reuses the open connection", async () => {
		const { ssh, connections } = setup();
		const first = await connections.connection(savedHost("a"));
		const second = await connections.connection(savedHost("a"));
		expect(first).toEqual({ ok: true, connectionId: "conn-1" });
		expect(second).toEqual({ ok: true, connectionId: "conn-1" });
		expect(ssh.connects).toHaveLength(1);
		expect(ssh.connects[0]).toMatchObject({ username: "dev", keyAlias: "app-key", expectedFingerprint: `SHA256:${"A".repeat(43)}` });
	});

	it("shares one connection attempt between callers that ask at the same time", async () => {
		const { ssh, connections } = setup();
		const [first, second] = await Promise.all([connections.connection(savedHost("a")), connections.connection(savedHost("a"))]);
		expect(first).toEqual(second);
		expect(ssh.connects).toHaveLength(1);
	});

	it("connects again when the previous connection closed", async () => {
		const { ssh, connections } = setup();
		await connections.connection(savedHost("a"));
		ssh.alive.clear();
		expect(await connections.connection(savedHost("a"))).toEqual({ ok: true, connectionId: "conn-2" });
	});

	it("asks to unlock only once for several computers, then connects", async () => {
		const { ssh, unlocks, connections } = setup();
		ssh.locked = true;
		const results = await Promise.all([connections.connection(savedHost("a")), connections.connection(savedHost("b"))]);
		expect(unlocks.count).toBe(1);
		expect(results.every((r) => r.ok)).toBe(true);
	});

	it("does not ask again after the user cancels, until asked to retry", async () => {
		const { ssh, unlocks, connections } = setup();
		ssh.locked = true;
		unlocks.answer = false;
		expect(await connections.connection(savedHost("a"))).toMatchObject({ ok: false, code: "UNLOCK_REQUIRED" });
		expect(await connections.connection(savedHost("a"))).toMatchObject({ ok: false, code: "UNLOCK_REQUIRED" });
		expect(unlocks.count).toBe(1);

		unlocks.answer = true;
		connections.allowUnlockAgain();
		expect(await connections.connection(savedHost("a"))).toMatchObject({ ok: true });
		expect(unlocks.count).toBe(2);
	});

	it("passes other connection failures through without unlocking", async () => {
		const { ssh, unlocks, connections } = setup();
		ssh.refuse = failure("HOST_KEY_CHANGED");
		expect(await connections.connection(savedHost("a"))).toMatchObject({ ok: false, code: "HOST_KEY_CHANGED" });
		expect(unlocks.count).toBe(0);
	});

	it("drops a connection on request and closes everything at the end", async () => {
		const { ssh, connections } = setup();
		await connections.connection(savedHost("a"));
		await connections.connection(savedHost("b"));
		await connections.drop("a");
		expect(ssh.disconnected).toEqual(["conn-1"]);
		await connections.closeAll();
		expect(ssh.disconnected).toEqual(["conn-1", "conn-2"]);
	});
});
