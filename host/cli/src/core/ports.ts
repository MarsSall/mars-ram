// Ports the host use cases need; adapters implement them for Linux and Windows.

export type InstallRecord = { homes: string[]; pending?: string[]; copy: string; version: string; date: string; cli?: string; launcher?: string; addedPath?: string };

export type InstallPorts = {
	preflight(): Promise<void>;
	recover(): Promise<void>;
	candidateHomes(): Promise<string[]>;
	readRecord(): Promise<InstallRecord | undefined>;
	writeRecord(record: InstallRecord): Promise<void>;
	buildCopy(): Promise<{ copy: string; version: string }>;
	installCli(record: InstallRecord): Promise<void>;
	isRegistered(home: string, copy: string): Promise<boolean>;
	register(home: string, copy: string): Promise<void>;
	remove(home: string, copy: string): Promise<void>;
	deleteInstallation(): Promise<void>;
	clock(): string;
};

export type PairingPorts = {
	clock: () => number;
	/** A random, URL-safe one-time code. */
	randomCode: () => string;
	/** OpenSSH-style SHA256 fingerprint of a public key line, shown when asking the user. */
	keyFingerprint: (publicKey: string) => string;
	/** Asks the user at the computer whether to authorize this phone. */
	confirm: (device: { deviceName: string; keyFingerprint: string }) => Promise<boolean>;
	/** Adds the key to the SSH authorized keys of the pairing user. */
	authorizeKey: (publicKey: string, deviceName: string) => Promise<{ ok: true } | { ok: false; message: string }>;
};

/** What the computer tells the phone about itself in the QR. */
export type HostInfo = {
	name: string;
	address: string;
	dnsName?: string;
	sshPort: number;
	user: string;
	hostKey: string;
	pairPort: number;
};
