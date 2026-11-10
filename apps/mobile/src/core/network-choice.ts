// Which private network the «Agregar computadora» wizard guides through (odd/tasks/zerotier.md S6); the last choice is remembered.

export type WizardNetwork = "tailscale" | "zerotier";

/** The saved choice as text; null when nothing was saved yet. */
export type NetworkChoiceStore = {
	read(): string | null;
	write(text: string): Promise<void>;
};

export function parseNetworkChoice(raw: string | null): WizardNetwork | null {
	try {
		const value: unknown = JSON.parse(raw ?? "null");
		return value === "tailscale" || value === "zerotier" ? value : null;
	} catch {
		return null;
	}
}

/** Tailscale until the user picks; storage failures never block the wizard, and the pick still holds for this opening. */
export class NetworkChoice {
	private chosen: WizardNetwork | null;

	constructor(private readonly store: NetworkChoiceStore) {
		let raw: string | null = null;
		try {
			raw = store.read();
		} catch {
			raw = null;
		}
		this.chosen = parseNetworkChoice(raw);
	}

	/** Null until the user picked once: the wizard asks first. */
	saved(): WizardNetwork | null {
		return this.chosen;
	}

	current(): WizardNetwork {
		return this.chosen ?? "tailscale";
	}

	async choose(network: WizardNetwork): Promise<void> {
		this.chosen = network;
		await this.store.write(JSON.stringify(network)).catch(() => {});
	}
}
