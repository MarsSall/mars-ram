// Ports the bridge core needs. Adapters implement them; the core never
// imports Pi, Node networking, or the file system.
import type { HistoryResponse, ImageInput, StateResponse } from "@workspace/protocol";

export type TerminalResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Visible screen and input of this session's own terminal only. */
export interface TerminalPort {
	/** Immutable identity captured at session start; reading it performs no I/O. */
	readonly paneId?: string;
	screen(): Promise<TerminalResult<string>>;
	/** Focus only the inherited pane's workspace and tab (shared between Herdr clients). */
	focus(): Promise<TerminalResult<void>>;
	text(text: string, enter: boolean): Promise<TerminalResult<void>>;
	/** Key names already validated with the protocol's TerminalInputRequest schema. */
	keys(keys: string[]): Promise<TerminalResult<void>>;
}

export type OutgoingContent = { text: string | undefined; images: ImageInput[] };

/** An upload found inside the uploads folder. `mimeType` is set only for images a model can read. */
export type ResolvedUpload = { path: string; size: number; mimeType: string | null };

/** The uploads folder the app copies attachments into. */
export interface UploadStorePort {
	/** The upload with this name, or null when it is missing, not a regular file, or resolves outside the folder. */
	resolve(name: string): Promise<ResolvedUpload | null>;
	readBase64(path: string): Promise<string>;
}

/** The live Pi session the bridge is loaded into. */
export interface PiSessionPort {
	sessionId(): string;
	isIdle(): boolean;
	hasPendingMessages(): boolean;
	model(): StateResponse["model"];
	/** Pi's `images.blockImages` setting: images are replaced by a placeholder before reaching any model. */
	imagesBlocked(): boolean;
	history(): HistoryResponse["messages"];
	/** Sends a user message; `steer` queues it after the current step, like Enter in Pi. */
	send(content: OutgoingContent, steer: boolean): void;
	/** Stops the current run, like Escape in Pi. */
	abort(): void;
}
