import { expect, it } from "vitest";
import { HerdrTerminal } from "../../src/core/herdr-terminal";
import { HostConnections } from "../../src/core/host-connections";
import type { HostConnection } from "../../src/core/ports";
import { FakeSsh, FakeTerminalChannel, FakeUploadsFolder, savedHost } from "../fakes";

it("reports real upload progress to the key bar before pasting paths", async () => {
 const fake = new FakeSsh(); fake.sourceSizes.set("file://a", 1); fake.sourceSizes.set("file://b", 1);
 const host = fake as unknown as HostConnection;
 const channel = new FakeTerminalChannel();
 const connections = new HostConnections({ host, keyAlias: "key", unlock: async () => false });
 const folder = new FakeUploadsFolder(); folder.result = { ok: true, folder: { path: "/tmp/my temp/uploads", sftpPath: "/tmp/my temp/uploads", windows: false } };
 const terminal = new HerdrTerminal({ host, channel, connections, uploadsFolder: folder, clock: () => 0, random: () => 0.5 }, savedHost("one"), { cols: 80, rows: 24 });
 await terminal.open();
 const progress: number[][] = [];
 const items = ["a", "b"].map(id => ({ id, sourceUri: `file://${id}`, displayName: `${id}.txt`, size: 1, mimeType: "text/plain", kind: "file" as const }));
 expect(await terminal.pasteAttachmentPaths(items, (n, total) => { expect(channel.writes).toHaveLength(0); progress.push([n, total]); })).toEqual({ ok: true });
 expect(progress).toEqual([[1, 2], [2, 2], [0, 2]]);
 const paths = [...fake.uploadedFiles.values()].map(file => `'/tmp/my temp/uploads/${file.name}'`);
 expect(channel.writes).toHaveLength(1);
 expect(new TextDecoder().decode(channel.writes[0].bytes)).toBe(`\x1b[200~${paths.join(" ")}\x1b[201~`);
 await terminal.close();
});
