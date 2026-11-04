import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{ test: { name: "unit", include: ["packages/*/test/**/*.test.ts", "host/*/test/unit/**/*.test.ts", "apps/*/test/**/*.test.ts"] } },
			{ test: { name: "contract", include: ["host/*/test/contract/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 } },
		],
	},
});
