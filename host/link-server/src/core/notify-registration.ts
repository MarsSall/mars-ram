export function privateNotifyMode(mode: number, directory: boolean): boolean { return (mode & 0o777) === (directory ? 0o700 : 0o600); }
/** Records without a network were written before ZeroTier support and are Tailscale. A ZeroTier record keeps
 * the computer's ZeroTier address the phone registered through, which selects the process that notifies it. */
export type NotifyRegistration = { address: string; port: number; secret: string; hostKeyId: string; network?: "zerotier"; hostAddress?: string };
/** The listener process a notifier runs in: Tailscale without a network, else one ZeroTier address. */
export type NotifyListener = { network?: "zerotier"; ip?: string };
/** Each listener process notifies only its own network's phones, so one notice never goes out twice. */
export function notifiedBy(row: NotifyRegistration, listener: NotifyListener): boolean {
 return listener.network === "zerotier" ? row.network === "zerotier" && row.hostAddress === listener.ip : row.network === undefined;
}
/** Which listeners registrations need, for the doctor: phones and secrets are left out. */
export function registrationNetworks(rows: NotifyRegistration[]): { tailscale: boolean; zerotier: string[] } {
 return { tailscale: rows.some(row => row.network === undefined), zerotier: [...new Set(rows.flatMap(row => row.network === "zerotier" && row.hostAddress ? [row.hostAddress] : []))].sort() };
}
export interface NotifyRegistrationStore {
 put(row: NotifyRegistration): Promise<void>;
 get(address: string): Promise<NotifyRegistration | null>;
 remove(address: string): Promise<void>;
}
