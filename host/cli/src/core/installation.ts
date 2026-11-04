import type { InstallPorts, InstallRecord } from "./ports.ts";

/** Blank means all; numbers identify homes to exclude, never shell arguments. */
export function selectHomes(homes: string[], answer: string): string[] {
	const tokens = answer.trim() ? answer.trim().split(/[\s,]+/) : [];
	if (tokens.some((token) => !/^\d+$/.test(token) || Number(token) < 1 || Number(token) > homes.length)) throw new Error("Invalid selection");
	const excluded = new Set(tokens.map(Number));
	return homes.filter((_, index) => !excluded.has(index + 1));
}

export class Installation {
	private readonly ports: InstallPorts;

	constructor(ports: InstallPorts) {
		this.ports = ports;
	}
	async homes(): Promise<string[]> {
		await this.ports.preflight();
		return this.ports.candidateHomes();
	}
	async record(): Promise<InstallRecord | undefined> {
		await this.ports.preflight();
		return this.ports.readRecord();
	}
	async install(homes: string[], confirmed: boolean): Promise<string[]> {
		if (!confirmed || homes.length === 0) return [];
		await this.ports.preflight();
		await this.ports.recover();
		const previous = await this.ports.readRecord();
		const copy = await this.ports.buildCopy();
		const record: InstallRecord = { ...previous, ...copy, homes: [...(previous?.homes ?? [])], pending: [...(previous?.pending ?? [])], date: this.ports.clock() };
		const skipped: string[] = [];
		const registrations = new Set<string>();
		for (const home of homes) {
			if (await this.ports.isRegistered(home, copy.copy)) {
				if (!record.homes.includes(home) && !record.pending!.includes(home)) skipped.push(home);
			} else {
				registrations.add(home);
				if (!record.pending!.includes(home)) record.pending!.push(home);
			}
		}
		// Durable intent precedes every Pi invocation, including the first fresh registration.
		await this.ports.writeRecord(record);
		await this.ports.installCli(record);
		for (const home of homes.filter((home) => !skipped.includes(home))) {
			if (registrations.has(home)) await this.ports.register(home, copy.copy);
			if (!record.homes.includes(home)) record.homes.push(home);
			record.pending = record.pending!.filter((entry) => entry !== home);
			await this.ports.writeRecord(record);
		}
		return skipped;
	}
	async uninstall(confirmed: boolean): Promise<string[]> {
		if (!confirmed) return [];
		await this.ports.preflight();
		await this.ports.recover();
		const record = await this.ports.readRecord();
		if (!record) { await this.ports.deleteInstallation(); return []; }
		const failures: string[] = [];
		for (const home of new Set([...record.homes, ...(record.pending ?? [])])) {
			try {
				if (await this.ports.isRegistered(home, record.copy)) await this.ports.remove(home, record.copy);
			} catch (error) {
				failures.push(`${home}: ${(error as Error).message}`);
				continue;
			}
			record.homes = record.homes.filter((entry) => entry !== home);
			record.pending = (record.pending ?? []).filter((entry) => entry !== home);
			await this.ports.writeRecord(record);
		}
		// Even unowned registrations in other homes still depend on the shared copy.
		let referenced = false;
		for (const home of record.homes.length || record.pending?.length ? [] : await this.ports.candidateHomes()) {
			try {
				if (!await this.ports.isRegistered(home, record.copy)) continue;
				referenced = true;
				failures.push(`Bridge copy kept: registration still references it in ${home}.`);
			} catch (error) {
				referenced = true;
				failures.push(`Bridge copy kept: cannot check registration in ${home}: ${(error as Error).message}`);
			}
		}
		if (!referenced && record.homes.length === 0 && !record.pending?.length) await this.ports.deleteInstallation();
		return failures;
	}
}
