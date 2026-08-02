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
		include: ["packages/*/src/**/*.test.ts"],
		coverage: {
			include: ["packages/*/src/**/*.ts"],
			exclude: ["packages/*/src/**/*.test.ts"],
		},
	},
});
