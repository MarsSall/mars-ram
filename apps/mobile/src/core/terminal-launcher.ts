/** Supported launch targets. Future integrations become data here, not screen-specific menus. */
export const terminalLauncherOptions = [
 { id: "standalone", name: "Herdr", enabled: true, default: true },
 { id: "future", enabled: false, default: false },
] as const;
