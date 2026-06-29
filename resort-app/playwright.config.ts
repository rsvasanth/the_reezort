import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Defaults to the live staging site; override with E2E_BASE_URL
 * to point at a local `bench start` (e.g. http://the-reezort.localhost:8000).
 */
export default defineConfig({
	testDir: "./e2e",
	timeout: 45_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	retries: 0,
	reporter: [["list"]],
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "https://app.thereezort.com",
		headless: true,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
