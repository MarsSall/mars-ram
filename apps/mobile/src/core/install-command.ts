/** The global install shown on the welcome screen, the same on every system: pnpm recommended, npm as the alternative. */
export const installCommands = {
 recommended: "pnpm add -g mars-ram",
 npm: "npm i -g mars-ram",
} as const;
