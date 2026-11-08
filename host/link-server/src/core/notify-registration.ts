export function privateNotifyMode(mode: number, directory: boolean): boolean { return (mode & 0o777) === (directory ? 0o700 : 0o600); }
export type NotifyRegistration = { address: string; port: number; secret: string; hostKeyId: string };
export interface NotifyRegistrationStore {
 put(row: NotifyRegistration): Promise<void>;
 get(address: string): Promise<NotifyRegistration | null>;
 remove(address: string): Promise<void>;
}
