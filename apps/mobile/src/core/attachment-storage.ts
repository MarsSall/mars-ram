/** Private phone storage. Names are upload names, never caller-supplied paths.
 * copy must reject sources/copies over maxBytes, including unknown source sizes.
 * hasCopy must verify that the URI names the expected private file, not an external URI.
 */
export interface AttachmentStorage {
 read(): string | null;
 write(json: string): Promise<void>;
 copy(sourceUri: string, name: string, maxBytes: number): Promise<string>;
 hasCopy(name: string, uri: string): boolean;
 list(): { name: string; modifiedAt: number }[];
 remove(name: string): Promise<void>;
}
