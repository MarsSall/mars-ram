// release-0.1.8 S5 / L8: the own-notification tap mark (shared_prefs/notice-tap.xml) never leaves the phone
// in Auto Backup (cloud) or device transfer; everything else keeps its default backup.
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import manifest from "../../app.json";

const require = createRequire(import.meta.url);
type Manifest = { manifest: { application: { $: Record<string, string> }[] } };
const plugin = require("../../plugins/with-backup-rules.js") as ((config: object) => { mods?: { android?: { manifest?: (config: object) => Promise<{ modResults: Manifest }> } } }) & {
	fullBackupXml: string; dataExtractionXml: string;
};

const fakeManifest = (attributes: Record<string, string> = {}): Manifest =>
	({ manifest: { application: [{ $: { "android:name": ".MainApplication", "android:allowBackup": "true", ...attributes } }] } });

async function run(manifestResult: Manifest, existing: Record<string, string> = {}) {
	const root = await mkdtemp(join(tmpdir(), "backup-rules-"));
	const xmlDir = join(root, "app/src/main/res/xml");
	await mkdir(xmlDir, { recursive: true });
	for (const [name, body] of Object.entries(existing)) await writeFile(join(xmlDir, name), body);
	const config = plugin({ name: "app", slug: "app" });
	const result = await config.mods!.android!.manifest!({
		name: "app", slug: "app", modResults: manifestResult,
		modRequest: { platform: "android", modName: "manifest", platformProjectRoot: root, projectRoot: root, introspect: false },
	});
	const read = (name: string) => readFile(join(xmlDir, name), "utf8");
	return { app: result.modResults.manifest.application[0].$, read, files: () => readdir(xmlDir) };
}

// L15: no merging. The plugin only writes its own two files into a project that has neither attribute nor file.
const FULL = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="sharedpref" path="notice-tap.xml"/>
</full-backup-content>
`;
const EXTRACTION = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="sharedpref" path="notice-tap.xml"/>
  </cloud-backup>
  <device-transfer>
    <exclude domain="sharedpref" path="notice-tap.xml"/>
  </device-transfer>
</data-extraction-rules>
`;

it("absent attributes and files: sets both attributes and creates both exclude-only files", async () => {
	const { app, read } = await run(fakeManifest());
	expect(app["android:fullBackupContent"]).toBe("@xml/backup_rules");
	expect(app["android:dataExtractionRules"]).toBe("@xml/data_extraction_rules");
	expect(app["android:allowBackup"]).toBe("true");
	expect(await read("backup_rules.xml")).toBe(FULL);
	expect(await read("data_extraction_rules.xml")).toBe(EXTRACTION);
});

it("the generated XML is unchanged: only sharedpref notice-tap.xml, no <include>", () => {
	expect(plugin.fullBackupXml).toBe(FULL);
	expect(plugin.dataExtractionXml).toBe(EXTRACTION);
	// No <include>: Android then backs up everything else as before (terminal buttons, threat-model.md:16).
	for (const xml of [FULL, EXTRACTION]) expect(xml).not.toContain("<include");
});

it.each([
	["fullBackupContent", { "android:fullBackupContent": "@xml/data_extraction_rules" }],
	["fullBackupContent", { "android:fullBackupContent": "true" }],
	["dataExtractionRules", { "android:dataExtractionRules": "@xml/other" }],
	["fullBackupContent", { "android:fullBackupContent": "@xml/backup_rules", "android:dataExtractionRules": "@xml/data_extraction_rules" }],
])("an existing %s attribute fails prebuild", async (name, attributes) => {
	const root = run(fakeManifest(attributes as Record<string, string>));
	await expect(root).rejects.toThrow(new RegExp(`^with-backup-rules: .*android:${name}.*merge .* by hand`));
});

it.each(["backup_rules.xml", "data_extraction_rules.xml"])("an existing res/xml/%s fails prebuild and is left untouched", async file => {
	const mine = '<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content/>\n';
	await expect(run(fakeManifest(), { [file]: mine })).rejects.toThrow(new RegExp(`^with-backup-rules: .*res/xml/${file.replace(".", "\\.")}.*merge .* by hand`));
});

it("a failed check writes neither file", async () => {
	const root = await mkdtemp(join(tmpdir(), "backup-rules-"));
	const xmlDir = join(root, "app/src/main/res/xml");
	await mkdir(xmlDir, { recursive: true });
	await writeFile(join(xmlDir, "data_extraction_rules.xml"), "kept");
	const config = plugin({ name: "app", slug: "app" });
	await expect(config.mods!.android!.manifest!({ name: "app", slug: "app", modResults: fakeManifest(),
		modRequest: { platform: "android", modName: "manifest", platformProjectRoot: root, projectRoot: root, introspect: false } })).rejects.toThrow();
	expect(await readdir(xmlDir)).toEqual(["data_extraction_rules.xml"]);
	expect(await readFile(join(xmlDir, "data_extraction_rules.xml"), "utf8")).toBe("kept");
});

// Expo applies each registered mod once per prebuild, so "running twice" is only a second registration.
it("is registered once in app.json, so every variant gets it and the mod runs once per prebuild", () => {
	expect(manifest.expo.plugins.filter(p => p === "./plugins/with-backup-rules")).toHaveLength(1);
});
