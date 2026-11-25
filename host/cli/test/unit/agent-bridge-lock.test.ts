// One bridge per session: the session lock. Every interleaving of two starters gives exactly one winner, and no
// state a crash or a failed release leaves behind keeps the next single start from taking the lock.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireSessionLock, releaseSessionLock, type SessionLockFs } from "../../src/adapters/agent-bridge.ts";
import { processRuns } from "../../src/adapters/process-identity.ts";

let dir: string;
let lock: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "agent-lock-")); lock = join(dir, "claude-s1.lock"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const real: SessionLockFs = {
	mkdir: (path) => mkdirSync(path),
	create: (path) => writeFileSync(path, "", { flag: "wx" }),
	rename: (from, to) => renameSync(from, to),
	readdir: (path) => readdirSync(path),
	readFile: (path) => readFileSync(path, "utf8"),
	unlink: (path) => unlinkSync(path),
	rmdir: (path) => rmdirSync(path),
};

/** The real file system, running `run` just before the `at`-th operation (counting from 0). */
function interleaved(at: number, run: () => void): SessionLockFs {
	let step = 0;
	const wrap = <A extends unknown[], R>(op: (...args: A) => R) => (...args: A): R => {
		if (step++ === at) run();
		return op(...args);
	};
	return { mkdir: wrap(real.mkdir), create: wrap(real.create), rename: wrap(real.rename), readdir: wrap(real.readdir), readFile: wrap(real.readFile), unlink: wrap(real.unlink), rmdir: wrap(real.rmdir) };
}

/** A lock dead bridge `pid` holds, as a crash leaves it. */
const deadMarker = (pid: number) => { mkdirSync(lock); writeFileSync(join(lock, `${pid}-00112233445566aa`), ""); };
const owners = () => readdirSync(lock);
/** What is left in the agents folder besides the lock. */
const leftovers = () => readdirSync(dir).filter((name) => name !== basename(lock));

describe("session lock", () => {
	it("takes a free lock, and refuses one a live bridge holds", () => {
		const first = acquireSessionLock(lock, 100, () => true);
		expect(first).toBeTruthy();
		expect(owners()).toEqual([basename(first!)]);
		expect(basename(first!)).toMatch(/^100-[0-9a-f]{16}$/);
		expect(acquireSessionLock(lock, 200, () => true)).toBeUndefined();
		expect(owners()).toEqual([basename(first!)]);
		expect(leftovers()).toEqual([]);
	});

	it("takes over a dead owner's lock on the first attempt", () => {
		deadMarker(100);
		const marker = acquireSessionLock(lock, 200, () => false);
		expect(marker).toBeTruthy();
		expect(owners()).toEqual([basename(marker!)]);
		expect(leftovers()).toEqual([]);
	});

	it("a lock with this process's own pid is left from an earlier process with the same pid", () => {
		deadMarker(200);
		expect(acquireSessionLock(lock, 200, () => true)).toBeTruthy();
	});

	it("a second starter during the first one's marker write: the lock is never visible empty, exactly one wins", () => {
		let inner: string | undefined;
		let seen: boolean | undefined;
		const fs: SessionLockFs = { ...real, create: (path) => {
			seen = existsSync(lock);
			inner = acquireSessionLock(lock, 300, (pid) => pid === 200 || pid === 300);
			real.create(path);
		} };
		const outer = acquireSessionLock(lock, 200, (pid) => pid === 200 || pid === 300, fs);
		expect(seen).toBe(false);
		expect(inner).toBeTruthy();
		expect(outer).toBeUndefined();
		expect(owners()).toEqual([basename(inner!)]);
		expect(leftovers()).toEqual([]);
	});

	const states: Record<string, () => void> = {
		free: () => {},
		"dead owner": () => deadMarker(100),
		"two dead owners": () => { deadMarker(100); writeFileSync(join(lock, "101-00112233445566bb"), ""); },
		"emptied by a starter that died": () => mkdirSync(lock),
		"older pid file of a dead owner": () => writeFileSync(lock, "100"),
	};
	for (const [state, prepare] of Object.entries(states)) {
		it(`two starters, every interleaving (${state}): exactly one wins and keeps the lock`, () => {
			const alive = (pid: number) => pid === 200 || pid === 300;
			for (let at = 0; at < 30; at++) {
				rmSync(lock, { recursive: true, force: true });
				prepare();
				let inner: string | undefined;
				const outer = acquireSessionLock(lock, 200, alive, interleaved(at, () => { inner = acquireSessionLock(lock, 300, alive); }));
				const winners = [outer, inner].filter(Boolean);
				expect(winners, `step ${at}`).toHaveLength(1);
				expect(owners(), `step ${at}`).toEqual([basename(winners[0]!)]);
				expect(leftovers(), `step ${at}`).toEqual([]);
				releaseSessionLock(winners[0]!);
				expect(existsSync(lock), `step ${at}`).toBe(false);
			}
		});
	}

	it("concurrent cleanup of a dead owner: the second cleaner finds the lock already retaken and leaves it", () => {
		deadMarker(100);
		const alive = (pid: number) => pid === 200 || pid === 300;
		let inner: string | undefined;
		// The first starter has listed the dead owner; the second does the whole takeover before it removes anything.
		const fs: SessionLockFs = { ...real, unlink: (path) => {
			if (inner === undefined) inner = acquireSessionLock(lock, 300, alive);
			real.unlink(path);
		} };
		const outer = acquireSessionLock(lock, 200, alive, fs);
		expect(inner).toBeTruthy();
		expect(outer).toBeUndefined();
		expect(owners()).toEqual([basename(inner!)]);
	});

	describe("what a crash leaves behind does not block the next single start", () => {
		it("an emptied lock", () => {
			mkdirSync(lock);
			expect(acquireSessionLock(lock, 200, () => false)).toBeTruthy();
		});

		it("an older pid file and an aged takeover guard", () => {
			writeFileSync(lock, "100");
			mkdirSync(`${lock}.takeover`);
			const old = new Date(Date.now() - 60_000);
			utimesSync(`${lock}.takeover`, old, old);
			expect(acquireSessionLock(lock, 200, () => false)).toBeTruthy();
		});

		it("an empty older lock file (a starter died before writing its pid)", () => {
			writeFileSync(lock, "");
			expect(acquireSessionLock(lock, 200, () => false)).toBeTruthy();
		});

		it("a dead starter's staging folder is swept; a live one's is left", () => {
			deadMarker(100);
			const stale = `${lock}.150-0011223344556677.tmp`;
			mkdirSync(stale);
			writeFileSync(join(stale, "150-0011223344556677"), "");
			const busy = `${lock}.160-0011223344556677.tmp`;
			mkdirSync(busy);
			writeFileSync(join(busy, "160-0011223344556677"), "");
			expect(acquireSessionLock(lock, 200, (pid) => pid === 160)).toBeTruthy();
			expect(existsSync(stale)).toBe(false);
			expect(existsSync(busy)).toBe(true);
		});
	});

	describe("release", () => {
		it("removes the marker and the lock folder", () => {
			const marker = acquireSessionLock(lock, 100, () => true)!;
			releaseSessionLock(marker);
			expect(readdirSync(dir)).toEqual([]);
		});

		it("a marker Windows keeps busy throws, and the next start still takes the lock once the owner is gone", () => {
			const marker = acquireSessionLock(lock, 100, () => true)!;
			expect(() => releaseSessionLock(marker, () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); })).toThrow("busy");
			const next = acquireSessionLock(lock, 200, (pid) => pid === 200);
			expect(next).toBeTruthy();
			expect(owners()).toEqual([basename(next!)]);
		});

		it("a lock folder left after the marker went is a free lock", () => {
			const marker = acquireSessionLock(lock, 100, () => true)!;
			unlinkSync(marker);
			expect(acquireSessionLock(lock, 200, () => true)).toBeTruthy();
		});

		it("an owner taken for dead releases only its own marker, never the new owner's lock", () => {
			const first = acquireSessionLock(lock, 100, () => true)!;
			const second = acquireSessionLock(lock, 200, (pid) => pid === 200)!;
			expect(() => releaseSessionLock(first)).not.toThrow();
			expect(owners()).toEqual([basename(second)]);
		});
	});

	describe("owner identity beyond the pid (L32 finding 5)", () => {
		const identities = (live: Record<number, string | undefined>) => (pid: number, start?: string) =>
			processRuns(pid, start, { alive: (p) => p in live, startTime: (p) => live[p] });

		it("a marker names its owner's start time when known, and stays `<pid>-<nonce>` otherwise", () => {
			const marker = acquireSessionLock(lock, 100, () => true, real, { start: "1000" })!;
			expect(basename(marker)).toMatch(/^100-1000-[0-9a-f]{16}$/);
			releaseSessionLock(marker);
			expect(basename(acquireSessionLock(lock, 100, () => true, real)!)).toMatch(/^100-[0-9a-f]{16}$/);
		});

		it("a dead owner whose pid now belongs to another process is taken over on the first start", () => {
			mkdirSync(lock);
			writeFileSync(join(lock, "100-1000-00112233445566aa"), "");
			const marker = acquireSessionLock(lock, 200, identities({ 100: "5000", 200: "2000" }), real, { start: "2000" });
			expect(marker).toBeTruthy();
			expect(owners()).toEqual([basename(marker!)]);
			expect(leftovers()).toEqual([]);
		});

		it("a live owner with its recorded start time, or one whose start time cannot be read, holds the lock", () => {
			mkdirSync(lock);
			writeFileSync(join(lock, "100-1000-00112233445566aa"), "");
			expect(acquireSessionLock(lock, 200, identities({ 100: "1000", 200: "2000" }), real)).toBeUndefined();
			expect(acquireSessionLock(lock, 200, identities({ 100: undefined, 200: "2000" }), real)).toBeUndefined();
			expect(owners()).toEqual(["100-1000-00112233445566aa"]);
		});

		it("a dead starter's staging folder whose pid was reused is swept", () => {
			const stale = `${lock}.150-1000-0011223344556677.tmp`;
			mkdirSync(stale);
			writeFileSync(join(stale, "150-1000-0011223344556677"), "");
			expect(acquireSessionLock(lock, 200, identities({ 150: "9999", 200: "2000" }), real)).toBeTruthy();
			expect(existsSync(stale)).toBe(false);
		});
	});

	describe("the owner's record travels inside its marker (L32 finding 4)", () => {
		it("is written before the lock is placed, so the lock is never seen without it", () => {
			let seenLock: boolean | undefined;
			const marker = acquireSessionLock(lock, 100, () => true, real, { record: (path) => { seenLock = existsSync(lock); writeFileSync(path, "record"); } })!;
			expect(seenLock).toBe(false);
			expect(readFileSync(marker, "utf8")).toBe("record");
		});

		it("a record that cannot be written leaves nothing behind", () => {
			expect(() => acquireSessionLock(lock, 100, () => true, real, { record: () => { throw new Error("disk full"); } })).toThrow("disk full");
			expect(readdirSync(dir)).toEqual([]);
		});

		it("a taker removes a dead owner's record only with its marker, by its exact name", () => {
			mkdirSync(lock);
			writeFileSync(join(lock, "100-00112233445566aa"), "old record");
			const marker = acquireSessionLock(lock, 200, (pid) => pid === 200, real, { record: (path) => writeFileSync(path, "new record") })!;
			expect(owners()).toEqual([basename(marker)]);
			expect(readFileSync(marker, "utf8")).toBe("new record");
		});
	});

	it("refuses a lock folder holding something that is not a marker", () => {
		mkdirSync(lock);
		writeFileSync(join(lock, "notes.txt"), "");
		expect(() => acquireSessionLock(lock, 200, () => false)).toThrow(/not a session lock marker/);
		expect(leftovers()).toEqual([]);
	});
});
