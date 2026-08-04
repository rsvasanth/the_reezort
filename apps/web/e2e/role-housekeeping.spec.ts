import { test, expect, Page } from "@playwright/test";

const DEMO_USER = "housekeeping@thereezort.com";
const DEMO_PASSWORD = "Reezort@Demo2026";
const DEMO_NAME = "Housekeeping";
const DEMO_ROLE = "Housekeeping";

async function login(page: Page): Promise<void> {
	await page.goto("/resort-app");
	await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText(DEMO_NAME).first()).toBeVisible({ timeout: 15000 });
}

/** Collect every /api/method/the_reezort response with status >= 400 during cb(). */
function trackApiErrors(page: Page): { collect: () => Array<{ url: string; status: number }> } {
	const failures: Array<{ url: string; status: number }> = [];
	page.on("response", (response) => {
		if (response.url().includes("/api/method/the_reezort") && response.status() >= 400) {
			failures.push({ url: response.url(), status: response.status() });
		}
	});
	return {
		collect: () => failures,
	};
}

test.describe("Housekeeping", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	// ── 1. Sidebar visibility & role badge ──────────────────────────────────
	test("sidebar shows allowed screens and hides forbidden ones; role badge reads Housekeeping", async ({ page }) => {
		// Role badge in the sidebar footer.
		await expect(page.getByTestId("user-role")).toHaveText(DEMO_ROLE);

		// Allowed sidebar links must be visible.
		await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Housekeeping" })).toBeVisible();
		await expect(page.getByRole("link", { name: "My tasks" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Service desk" })).toBeVisible();

		// Forbidden sidebar links must not appear (spot-check per spec).
		await expect(page.getByRole("link", { name: "Billing" })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Restaurant & bar" })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Staff & access" })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Reservations" })).toHaveCount(0);
	});

	// ── 2. Executive cockpit ─────────────────────────────────────────────────
	test("Executive cockpit loads without API errors and accepts a Refresh prototype click", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/cockpit");

		// Loaded assertion: h1 renders immediately before async data resolves.
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible();

		// Primary action: Refresh prototype link just reloads the SPA — idempotent.
		await page.getByRole("link", { name: "Refresh prototype" }).click();

		// Allow the page to settle after the reload.
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible({ timeout: 15000 });

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /cockpit: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 3. Housekeeping board ────────────────────────────────────────────────
	test("Housekeeping board loads without API errors and accepts a Refresh click", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/housekeeping");

		// Loaded assertion: Refresh button only mounts once snapshotState leaves 'loading'.
		await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible({ timeout: 15000 });

		// Primary action: re-trigger the board fetch — fully idempotent.
		await page.getByRole("button", { name: "Refresh" }).click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /housekeeping: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 4. My tasks ──────────────────────────────────────────────────────────
	test("My tasks screen loads without API errors and switches to History tab", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/my-tasks");

		// Loaded assertion: h1 renders immediately inside WorkspacePage.
		await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();

		// The screen wrapper should be in the DOM.
		await expect(page.getByTestId("my-tasks-screen")).toBeVisible();

		// Primary action: switch to the History tab.
		await page.getByTestId("tab-history").click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /my-tasks: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 5. Service desk ──────────────────────────────────────────────────────
	test("Service desk loads without API errors and opens the New ticket sheet", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/servicedesk");

		// Loaded assertion: h1 renders immediately.
		await expect(page.getByRole("heading", { name: "Service desk" })).toBeVisible();

		// Primary action: open NewTicketSheet without submitting (no API mutation).
		await page.getByTestId("new-ticket").click();

		// The sheet should be visible after click.
		await expect(page.getByTestId("ticket-sheet")).toBeVisible();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /servicedesk: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});
});
