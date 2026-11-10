import { NativeModule, requireNativeModule } from "expo";

export type KeyInfo = { publicKey: string; fingerprint: string };

export type ConnectOptions = {
	host: string;
	/** Tried when the host name cannot be resolved, for example the host's Tailscale IP. */
	fallbackHost: string | null;
	port: number;
	username: string;
	keyAlias: string;
	/** null on first contact: the module reports the host identity instead of trusting it. */
	expectedFingerprint: string | null;
};

export type FailureCode =
	| "KEY_MISSING"
	| "KEY_INVALIDATED"
	| "UNLOCK_REQUIRED"
	| "HOST_KEY_UNKNOWN"
	| "HOST_KEY_CHANGED"
	| "HOST_NOT_FOUND"
	| "UNREACHABLE"
	| "AUTH_FAILED"
	| "TIMEOUT"
	| "NOT_CONNECTED"
	| "NOT_FOUND"
	| "PERMISSION_DENIED"
	| "TOO_LARGE"
	| "SOURCE_UNREADABLE"
	| "SSH_ERROR";

export type Failure = {
	ok: false;
	code: FailureCode;
	message: string;
	/** The host identity seen, for HOST_KEY_UNKNOWN and HOST_KEY_CHANGED. */
	fingerprint?: string;
	expected?: string | null;
	/** Technical detail for AUTH_FAILED. */
	detail?: string;
};

export type ConnectResult = { ok: true; connectionId: string; fingerprint: string; address: string } | Failure;
export type DirEntry = { name: string; isFile: boolean; size: number; modifiedAt: number };
export type ListResult = { ok: true; entries: DirEntry[] } | Failure;
export type ReadResult = { ok: true; content: string } | Failure;
export type ForwardResult = { ok: true; forwardId: string; localPort: number } | Failure;
export type ExecResult = { ok: true; stdout: string; stderr: string; exitStatus: number | null } | Failure;

export type TerminalOutputEvent = { terminalId: string; data: string };
export type TerminalExitEvent = { terminalId: string; exitStatus: number | null; reason: string };
export type SshEvents = {
	onTerminalOutput: (event: TerminalOutputEvent) => void;
	onTerminalExit: (event: TerminalExitEvent) => void;
	onAppUpdateStatus: (event: AppUpdateStatusEvent) => void;
};

/** Google Play's answer; every failure (no Play, sideloaded, errors) is available:false. */
export type AppUpdateCheckResult = { available: boolean; versionCode?: number; downloaded?: boolean };
/** started is false when the user declines Play's prompt or Play is unavailable. */
export type FlexibleUpdateResult = { started: boolean; downloaded: boolean };
/** How a running flexible download ended. */
export type AppUpdateStatusEvent = { status: "downloaded" | "failed" | "canceled" };
/** Private DNS counts only in strict mode (a provider hostname), the mode that breaks MagicDNS names. */
/** vpnOn: some VPN is active; Android does not say which app owns it. */
export type NativePhoneNetworkState = { tailscaleInstalled: boolean; tailscaleOn: boolean; privateDnsActive?: boolean; zerotierInstalled: boolean; vpnOn: boolean };
/** The ZeroTier pairing answer; every refusal or failure resolves, never rejects. */
export type VpnPairingResult =
	| { ok: true; status: number; body: string }
	| { ok: false; code: "NOT_ON_VPN" | "INVALID_REQUEST" | "UNREACHABLE" | "TIMEOUT" | "BAD_RESPONSE" };
export type AppBuildInfo = { versionCode: number | null; versionName: string | null };
/** The one system download (Android DownloadManager) kept for the voice model. total is -1 until
 * the server reports it; uri is the downloaded file, set once successful. */
export type ModelDownloadNative = {
	state: "none" | "pending" | "running" | "paused" | "successful" | "failed";
	written: number;
	total: number;
	uri: string | null;
};

/** Native-only configuration. Supply each saved host's actual key generation, not the current setting's alias. */
export type AlwaysNotifyRegistration = { secret: string; port: number };
/** hostKeyId is the saved SSH SHA256 fingerprint, never an address or display name. */
export type AlwaysWatchHost = { hostId: string; hostKeyId: string };
export type SessionWatchConfig =
	| { appId: string; language?: "es" | "en"; mode?: "while-working"; hosts: { hostId: string; connection: ConnectOptions & { expectedFingerprint: string } }[] }
	| { appId: string; language?: "es" | "en"; mode: "always"; hosts: AlwaysWatchHost[] };
export type SessionWatchStartResult = { ok: true } | { ok: false; code: "APP_NOT_VISIBLE" | "INVALID_CONFIG" | "NOTIFICATIONS_DENIED" | "START_NOT_ALLOWED" | "PERMISSION_DENIED" };
/** A phone address «Siempre atento» listens on: Tailscale, or another VPN (ZeroTier) admitting only its own subnet. */
export type AlwaysListeningNetwork = { kind: "tailscale" | "vpn"; address: string; prefix: number };
export type SessionWatchStatus = {
	state: "stopped" | "starting" | "running" | "error";
	hosts: Record<string, "connecting" | "connected" | "connection-lost" | "unlock-required">;
	mode?: "while-working" | "always";
	/**
	 * PRIVATE_NETWORK_REQUIRED: no Tailscale or other VPN address to listen on. As an error it ended the start; with
	 * state "running" the watch waits for a VPN to come back. TAILSCALE_REQUIRED is only from older builds.
	 */
	code?: "START_NOT_ALLOWED" | "PERMISSION_DENIED" | "WATCH_FAILED" | "PRIVATE_NETWORK_REQUIRED" | "TAILSCALE_REQUIRED";
	/** Mode "always" while running: where the phone listens now; empty while no VPN is on. Missing in older builds. */
	networks?: AlwaysListeningNetwork[];
};

/** Future notification adapters can use a relay; no SSH capability is part of this consumer port. */
export interface SessionNotificationSource {
	configure(config: SessionWatchConfig): Promise<SessionWatchStartResult>;
	getStatus(): SessionWatchStatus;
	subscribe(listener: (status: SessionWatchStatus) => void): { remove(): void };
}

declare class SshModule extends NativeModule<SshEvents> {
	/** The installed Android versionCode and versionName from PackageManager. */
	appBuild(): AppBuildInfo;
	/** Never rejects. Play performs the check; the app sends nothing. */
	checkAppUpdate(): Promise<AppUpdateCheckResult>;
	/** Play's flexible update prompt; onAppUpdateStatus fires when the download ends. */
	startFlexibleUpdate(): Promise<FlexibleUpdateResult>;
	/** Play's current flexible download, regardless of any cached check; listens again while it runs. Never rejects. */
	appUpdateProgress(): Promise<"none" | "downloading" | "downloaded">;
	/** Installs the downloaded update; Play restarts the app. Never rejects. */
	completeUpdate(): Promise<void>;
	/** Starts a DownloadManager download (https only) into the app's external files folder, with a
	 * system notification; returns the one already pending, running, paused or finished instead of
	 * starting a second one. Needs no permission. Never rejects; failures are state "failed". */
	startModelDownload(url: string, fileName: string, title: string, description: string): Promise<ModelDownloadNative>;
	/** The kept download's state; "none" when there is none or the system dropped it. Never rejects. */
	modelDownloadStatus(): Promise<ModelDownloadNative>;
	/** Removes the kept download (DownloadManager deletes its file and notification) and forgets it. */
	cancelModelDownload(): Promise<void>;
	/** Explicit opt-in, while resumed; caller must first obtain notification permission (T3). */
	startSessionWatch(config: SessionWatchConfig): Promise<SessionWatchStartResult>;
	stopSessionWatch(): Promise<void>;
	sessionWatchStatus(): SessionWatchStatus;
	/** Returns a stable per-computer secret. Send only through authenticated SSH stdin; never log it. */
	registerAlwaysNotify(hostId: string): Promise<AlwaysNotifyRegistration>;
	/** Local revocation; the caller must also unregister on the host over SSH. */
	forgetAlwaysNotify(hostId: string): Promise<void>;
	isIgnoringBatteryOptimizations(): boolean;
	/** Opens the general system screen; does not request the restricted exemption permission. */
	openBatteryOptimizationSettings(): Promise<void>;
	/** Read-only checks for the connection wizard; privateDnsActive is missing below Android 9. */
	phoneNetworkState(): Promise<NativePhoneNetworkState>;
	/** Play Store page of Tailscale (market://, then https). Rejects STORE_UNAVAILABLE. */
	installTailscale(): Promise<void>;
	/** Launches Tailscale, or its store page when it is not installed. Rejects STORE_UNAVAILABLE. */
	openTailscale(): Promise<void>;
	/** Play Store page of ZeroTier (market://, then https). Rejects STORE_UNAVAILABLE. */
	installZeroTier(): Promise<void>;
	/** Launches ZeroTier, or its store page when it is not installed. Rejects STORE_UNAVAILABLE. */
	openZeroTier(): Promise<void>;
	/** Network settings (no public Private DNS screen exists), then Settings. Rejects SETTINGS_UNAVAILABLE. */
	openPrivateDnsSettings(): Promise<void>;
	openTerminal(connectionId: string, command: string[], cols: number, rows: number, term?: string): Promise<{ ok: true; terminalId: string } | Failure>;
	writeTerminal(terminalId: string, base64Data: string): Promise<{ ok: true } | Failure>;
	resizeTerminal(terminalId: string, cols: number, rows: number): Promise<{ ok: true } | Failure>;
	closeTerminal(terminalId: string): Promise<void>;
	ensureKey(alias: string, requireUnlock: boolean, comment: string): Promise<KeyInfo>;
	deleteKey(alias: string): Promise<void>;
	unlock(title: string): Promise<boolean>;
	connect(options: ConnectOptions): Promise<ConnectResult>;
	exec(connectionId: string, command: string): Promise<ExecResult>;
	/** 1024-byte stdin, 4096-byte output per stream, 30 s deadline. Never logs input/remote diagnostics. */
	execWithInput(connectionId: string, command: string, input: string): Promise<ExecResult>;
	setNotificationLanguage(language: "es" | "en"): Promise<void>;
	disconnect(connectionId: string): Promise<void>;
	isConnected(connectionId: string): boolean;
	/** Whether an SSH server answers at host:port, reading only its greeting; never asks for an unlock. */
	probe(host: string, port: number, timeoutMs: number): Promise<boolean>;
	/**
	 * ZeroTier pairing only: POST /pair with a JSON body over plain HTTP to exactly address:port. Refuses unless the
	 * address is an IPv4 literal routed through an active VPN; waits at most timeoutMs in total; reads at most 16 KiB.
	 */
	postPairingOverVpn(address: string, port: number, body: string, timeoutMs: number): Promise<VpnPairingResult>;
	/** SFTP realpath("."); Windows drive paths are returned in native backslash form. */
	homeDirectory(connectionId: string): Promise<{ ok: true; path: string } | Failure>;
	/** Paths are relative to the user's home on the host, on Linux and Windows alike. */
	/** root: an absolute uploads folder; then path must equal it. null keeps paths relative to home. */
	listDir(connectionId: string, path: string, root: string | null): Promise<ListResult>;
	readFile(connectionId: string, path: string, maxBytes: number): Promise<ReadResult>;
	/** All-or-nothing upload from a content:// or file:// URI; remoteDir is relative to home. Never overwrites an existing name.
	 * With root, remoteDir must equal that existing absolute folder, which is never created. */
	uploadFile(connectionId: string, sourceUri: string, remoteDir: string, remoteName: string, maxBytes: number, root: string | null): Promise<{ ok: true; size: number } | Failure>;
	/** Removes one regular file, relative to home or directly inside root. */
	removeFile(connectionId: string, path: string, root: string | null): Promise<{ ok: true } | Failure>;
	/** Phone binds 127.0.0.1; the only remote destinations are 127.0.0.1 (default) and ::1. */
	forwardLocal(connectionId: string, remotePort: number, remoteHost?: "127.0.0.1" | "::1"): Promise<ForwardResult>;
	closeForward(forwardId: string): Promise<void>;
}

export default requireNativeModule<SshModule>("Ssh");
