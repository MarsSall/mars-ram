const { withAndroidManifest } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");
// Generated only during Expo prebuild (release-0.1.8 S5, owner decision L8). The own-notification tap mark
// (NoticeTapTokens.kt, shared_prefs/notice-tap.xml) must stay on this phone: it is excluded from Auto Backup
// (Android ≤ 11 full-backup-content; Android 12+ cloud-backup) and from device-to-device transfer. Only
// excludes are written, never an <include>, so everything else keeps the default backup (the owner keeps
// terminal buttons backed up, docs/threat-model.md).
// No merging (L15): the plugin writes its two files only into a project with neither backup attribute on
// <application> and neither file in res/xml; anything already there fails prebuild, to be merged by hand.
const fullBackupXml = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="sharedpref" path="notice-tap.xml"/>
</full-backup-content>
`;
const dataExtractionXml = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="sharedpref" path="notice-tap.xml"/>
  </cloud-backup>
  <device-transfer>
    <exclude domain="sharedpref" path="notice-tap.xml"/>
  </device-transfer>
</data-extraction-rules>
`;
const RULES = [
 { attribute: "android:fullBackupContent", name: "backup_rules", xml: fullBackupXml },
 { attribute: "android:dataExtractionRules", name: "data_extraction_rules", xml: dataExtractionXml },
];
const fail = what => { throw new Error(`with-backup-rules: ${what} already exists; merge the sharedpref notice-tap.xml exclude into it by hand (see plugins/with-backup-rules.js) and remove this plugin, or remove it and run prebuild with --clean.`); };

const exists = file => fs.access(file).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });

module.exports = function withBackupRules(config) {
 return withAndroidManifest(config, async config => {
  const app = config.modResults.manifest.application[0].$;
  const dir = path.join(config.modRequest.platformProjectRoot, "app/src/main/res/xml");
  // Check everything before writing anything, so a failed prebuild leaves no file of ours behind.
  for (const { attribute } of RULES) if (app[attribute] !== undefined) fail(`<application ${attribute}="${app[attribute]}">`);
  for (const { name } of RULES) if (await exists(path.join(dir, `${name}.xml`))) fail(`res/xml/${name}.xml`);
  await fs.mkdir(dir, { recursive: true });
  for (const { attribute, name, xml } of RULES) {
   await fs.writeFile(path.join(dir, `${name}.xml`), xml, { flag: "wx" });
   app[attribute] = `@xml/${name}`;
  }
  return config;
 });
};
module.exports.fullBackupXml = fullBackupXml;
module.exports.dataExtractionXml = dataExtractionXml;
