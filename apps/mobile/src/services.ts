// Wires the use cases to their adapters. Screens import from here, never from adapters directly.
import Ssh from "../modules/ssh/src/SshModule";
import * as Clipboard from "expo-clipboard";
import { fetchBridgeHttp } from "./adapters/bridge-http";
import { fileHostCatalog } from "./adapters/file-host-catalog";
import { fileLinkHistory } from "./adapters/file-link-history";
import { fileShortcuts } from "./adapters/file-shortcuts";
import { ShortcutHost } from "./core/shortcuts";
import { fileKeySecurity } from "./adapters/file-key-security";
import { KeySecurity, type KeyGeneration } from "./core/key-security";
import { LinkService } from "./core/links";
import { Servers, ServerTunnel } from "./core/servers";
import { HerdrSwitcher } from "./core/herdr-switcher";
import { ProjectBrowser } from "./core/project";
import { createOnDeviceDictation } from "./adapters/on-device-dictation";
import { deviceName, newId, postJson } from "./adapters/platform";
import { sshModuleHostConnection, sshModuleTerminalChannel } from "./adapters/ssh-module-host-connection";
import { HerdrTerminal, type HerdrOptions } from "./core/herdr-terminal";
import { xhrEventStream } from "./adapters/xhr-event-stream";
import type { SavedHost } from "./core/host-catalog";
import { HostConnections } from "./core/host-connections";
import { type EndpointResult, LiveSession } from "./core/live-session";
import { confirmManualHost, discoverIdentity, type ManualHostDeps, type ManualHostDetails } from "./core/manual-host";
import { pairWithComputer, type PairingDeps } from "./core/pairing";
import { checkReachability } from "./core/reachability";
import { SessionLister } from "./core/session-list";
import { bridgeClient } from "./core/bridge-client";
import type { AttachmentUploads } from "./core/attachment-uploads";
import { AttachmentHistory } from "./core/attachment-history";

import { expoAttachmentStorage } from "./adapters/expo-attachment-storage";

/** Shared across chat and terminal; reload only verified private image copies. */
export const attachmentHistory = new AttachmentHistory(expoAttachmentStorage);
import { expoMediaSource } from "./adapters/expo-media-source";
import { readRetention, writeRetention } from "./adapters/file-retention-preference";
import type { AttachmentRetention } from "./core/attachment-retention";
import type { AttachmentSource } from "./core/media-source";

export const chooseAttachments = (source: AttachmentSource) => expoMediaSource.select(source);
let retention = readRetention();
// One best-effort phone cleanup per opening, independent of host connections.
void attachmentHistory.cleanup(retention);
export const attachmentPreference = {
 get: () => retention,
 set: async (value: AttachmentRetention) => { await writeRetention(value); retention = value; },
};

/** The app's own SSH key; device unlock is required to use it (PRD R1, on by default). */
export const KEY_ALIAS = "app-ssh-key";
const PROBE_TIMEOUT_MS = 4_000;

export const catalog = fileHostCatalog;
/** Clipboard adapter: read only after an explicit paste action. */
export const clipboard = { readText: () => Clipboard.getStringAsync(), writeText: (text: string) => Clipboard.setStringAsync(text) };

export const keySecurity = new KeySecurity({
 store: fileKeySecurity, catalog, host: sshModuleHostConnection,
 credentials: {
  ensureKey: (alias, requireUnlock, comment) => Ssh.ensureKey(alias, requireUnlock, comment),
  deleteKey: alias => Ssh.deleteKey(alias),
  unlock: () => unlock(unlockTitle),
 },
});
export const appKey = { ensure: () => keySecurity.current() };

export function unlock(title: string): Promise<boolean> {
	return Ssh.unlock(title);
}

export function pair(uri: string, unlockTitle: string) {
 return keySecurity.withCurrent(async key => {
	const deps: PairingDeps = {
		clock: Date.now,
		deviceName: deviceName(),
		keyAlias: key.alias,
		appKey: { ensure: async () => ({ publicKey: key.publicKey }) },
		probe: (address, port) => Ssh.probe(address, port, PROBE_TIMEOUT_MS),
		http: { postJson },
		host: sshModuleHostConnection,
		catalog,
		newId,
		unlock: () => key.requireUnlock ? unlock(unlockTitle) : Promise.resolve(true),
	};
	return pairWithComputer(deps, uri);
 });
}

const manualDeps = (unlockTitle: string, key: KeyGeneration): ManualHostDeps => ({
	clock: Date.now,
	keyAlias: key.alias,
	newId,
	unlock: () => key.requireUnlock ? unlock(unlockTitle) : Promise.resolve(true),
	host: sshModuleHostConnection,
	catalog,
});

export const manual = {
	discoverIdentity: (details: ManualHostDetails) => keySecurity.withCurrent(key => discoverIdentity(manualDeps("", key), details)),
	confirm: (details: ManualHostDetails, fingerprint: string, unlockTitle: string) => keySecurity.withCurrent(key => confirmManualHost(manualDeps(unlockTitle, key), details, fingerprint)),
};

export function reachability(host: SavedHost) {
	return checkReachability((address, port) => Ssh.probe(address, port, PROBE_TIMEOUT_MS), host);
}

// ---- Sessions ----

let unlockTitle = "";

/** The text the system unlock prompt shows, in the app's language. */
export function setUnlockTitle(title: string): void {
	unlockTitle = title;
}

const connections = new HostConnections({ host: sshModuleHostConnection, catalog, keyAlias: KEY_ALIAS, unlock: () => unlock(unlockTitle), retention: () => retention,
 // Independent, non-blocking maintenance: rotation resumes on every fresh
 // connection; link restoration and retention remain once per app opening.
 afterConnect: computer => keySecurity.resume(computer.id),
 afterFirstConnect: (computer, connectionId) => createLinkService(computer).restore(connectionId),
});
export const herdrSwitcher = new HerdrSwitcher({ connections, host: sshModuleHostConnection });
export const shortcuts = fileShortcuts;
export const shortcutHost = new ShortcutHost({ connections, host: sshModuleHostConnection });
export const newShortcutId = newId;
export const servers = new Servers({ connections, host: sshModuleHostConnection });
export const projectBrowser = new ProjectBrowser({ connections, host: sshModuleHostConnection });
/** On-device dictation (Parakeet or Whisper); one recorder and model for the whole app. */
export const dictation = createOnDeviceDictation();
export const createServerTunnel = () => new ServerTunnel({ connections, host: sshModuleHostConnection });
/** Files uses the same saved computer and authenticated connection pool as sessions/terminal. */
export function createLinkService(computer: SavedHost): LinkService {
 return new LinkService({ connections, host: sshModuleHostConnection, history: fileLinkHistory, clock: Date.now, random: Math.random }, computer);
}
/** Screens own activity/output; session focus is optional and never blocks the PTY. */
export function createHerdrTerminal(computer: SavedHost, options: HerdrOptions): HerdrTerminal {
	return new HerdrTerminal({ connections, channel: sshModuleTerminalChannel, host: sshModuleHostConnection,
		clock: Date.now, random: Math.random, history: attachmentHistory,
		focusSession: async (key, fresh, isCurrent) => {
			// Reconnecting the PTY drops SSH; rebuild its old bridge tunnel before focusing.
			const endpoint = await sessionEndpoint(key, fresh);
			// A late focus from a closed terminal would move Herdr away from the session now open.
			if (typeof endpoint !== "string" && isCurrent()) await bridgeClient.terminalFocus(fetchBridgeHttp, endpoint);
		} }, computer, options);
}

const lister = new SessionLister({ connections, host: sshModuleHostConnection, http: fetchBridgeHttp });

/** Session keys are "<computer id>/<bridge instance id>". */
const hostIdOf = (key: string) => key.slice(0, key.indexOf("/"));

async function sessionEndpoint(key: string, fresh: boolean): Promise<EndpointResult> {
	const known = fresh ? null : lister.endpoint(key);
	if (known) return known;
	const hosts = await catalog.list();
	const computer = (await lister.list(hosts)).find((c) => c.hostId === hostIdOf(key));
	if (!computer) return "gone";
	if (computer.state !== "ok" && computer.state !== "no-pi") return "unreachable";
	return lister.endpoint(key) ?? "gone";
}

function sessionUploads(key: string): AttachmentUploads {
	return {
		history: attachmentHistory,
		host: sshModuleHostConnection,
		connection: async () => {
			const host = (await catalog.list()).find(host => host.id === hostIdOf(key));
			return host ? connections.connection(host) : { ok: false, code: "NOT_CONNECTED", message: "The computer is no longer saved." };
		},
		clock: Date.now,
		random: Math.random,
	};
}

export const sessions = {
	/** null is unknown/unreachable, not evidence that a session is outside Herdr. */
	terminalCapability: async (key: string): Promise<boolean | null> => {
		const endpoint = await sessionEndpoint(key, false);
		if (typeof endpoint === "string") return null;
		const state = await bridgeClient.state(fetchBridgeHttp, endpoint);
		return state.ok ? state.value.terminal === true : null;
	},
	terminalAvailable: async (key: string): Promise<boolean> => {
		const endpoint = await sessionEndpoint(key, false);
		if (typeof endpoint === "string") return false;
		const state = await bridgeClient.state(fetchBridgeHttp, endpoint);
		return state.ok && state.value.terminal === true;
	},
	list: async () => {
		const hosts = await catalog.list();
		return { hosts, computers: await lister.list(hosts) };
	},
	/** A refresh by hand: after a cancelled unlock, the next connection may ask again. */
	allowUnlockAgain: () => connections.allowUnlockAgain(),
	follow: (key: string) =>
		new LiveSession({
			uploads: sessionUploads(key),
			http: fetchBridgeHttp,
			events: xhrEventStream,
			timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
			endpoint: (fresh) => sessionEndpoint(key, fresh),
		}),
};
