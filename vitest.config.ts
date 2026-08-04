import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure-TypeScript packages only.
 *
 * React Native component tests need jest-expo and belong to the apps, not here.
 * Keeping this runner node-only is what lets `packages/api-client` inject its
 * crypto, browser, and storage primitives instead of importing Expo modules.
 */
export default defineConfig({
	test: {
		environment: "node",
		// Apps are included for pure-TypeScript modules only (copy, derivation).
		// React Native component tests need jest-expo and do not belong here.
		include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
		coverage: {
			include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
			exclude: ["packages/*/src/**/*.test.ts"],
		},
	},
});
