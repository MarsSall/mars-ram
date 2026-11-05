const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");
// Generated only during Expo prebuild. Cleartext is allowed to loopback (SSH tunnels) and to names under
// ts.net, for pairing: the computer's MagicDNS name normally resolves to its tailnet address, so the request
// travels inside Tailscale's WireGuard encryption. The suffix alone does not prove the route, and the exception
// is app-wide (a page in the servers viewer can also load ts.net subresources). Never permit cleartext to LAN
// or public addresses, or to tailnet IPs by number.
const xml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">ts.net</domain>
  </domain-config>
</network-security-config>
`;
module.exports = function withLoopbackNetworkSecurity(config) {
 config = withAndroidManifest(config, config => {
  const app = config.modResults.manifest.application[0].$;
  delete app["android:usesCleartextTraffic"];
  app["android:networkSecurityConfig"] = "@xml/loopback_network_security";
  return config;
 });
 return withDangerousMod(config, ["android", async config => {
  const dir = path.join(config.modRequest.platformProjectRoot, "app/src/main/res/xml");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "loopback_network_security.xml"), xml);
  return config;
 }]);
};
module.exports.networkSecurityXml = xml;
