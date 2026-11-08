const { withAndroidManifest } = require("expo/config-plugins");

// Idempotent; never removes the existing blocked-permissions entries.
module.exports = function withSessionWatch(config) {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] ??= [];
    for (const name of ["POST_NOTIFICATIONS", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_CONNECTED_DEVICE", "CHANGE_NETWORK_STATE"]) {
      const permission = `android.permission.${name}`;
      if (!manifest["uses-permission"].some(entry => entry.$["android:name"] === permission)) {
        manifest["uses-permission"].push({ $: { "android:name": permission } });
      }
    }
    const app = manifest.application[0];
    app.service ??= [];
    const name = "expo.modules.ssh.SessionWatchService";
    const existing = app.service.find(entry => entry.$["android:name"] === name);
    const attributes = { "android:name": name, "android:exported": "false", "android:foregroundServiceType": "connectedDevice", "android:stopWithTask": "false" };
    if (existing) Object.assign(existing.$, attributes);
    else app.service.push({ $: attributes });
    return config;
  });
};
