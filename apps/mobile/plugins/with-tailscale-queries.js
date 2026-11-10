const { withAndroidManifest } = require("expo/config-plugins");

const TAILSCALE_PACKAGE = "com.tailscale.ipn";
const ZEROTIER_PACKAGE = "com.zerotier.one";

// Android 11+ package visibility: lets the connection wizard see whether Tailscale or ZeroTier is installed and
// launch it. Only these two packages; never QUERY_ALL_PACKAGES. Also declares ACCESS_NETWORK_STATE, the normal
// (install-time) permission the wizard's ConnectivityManager reads need, instead of relying on a dependency.
// Idempotent; merges into an existing <queries> block.
function addTailscaleQueries(manifest) {
 manifest["uses-permission"] ??= [];
 const permission = "android.permission.ACCESS_NETWORK_STATE";
 if (!manifest["uses-permission"].some(entry => entry.$?.["android:name"] === permission)) {
  manifest["uses-permission"].push({ $: { "android:name": permission } });
 }
 manifest.queries ??= [];
 if (manifest.queries.length === 0) manifest.queries.push({});
 for (const name of [TAILSCALE_PACKAGE, ZEROTIER_PACKAGE]) {
  const present = manifest.queries.some(block => (block.package ?? []).some(entry => entry.$?.["android:name"] === name));
  if (!present) {
   const block = manifest.queries[0];
   block.package ??= [];
   block.package.push({ $: { "android:name": name } });
  }
 }
 return manifest;
}

module.exports = function withTailscaleQueries(config) {
 return withAndroidManifest(config, config => {
  addTailscaleQueries(config.modResults.manifest);
  return config;
 });
};
module.exports.addTailscaleQueries = addTailscaleQueries;
