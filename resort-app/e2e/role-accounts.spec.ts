import { test, expect, type Page } from "@playwright/test";

const DEMO_USER = "accounts@thereezort.com";
const DEMO_PASSWORD = "Reezort@Demo2026";
const DEMO_NAME = "Accounts";
// accounts@thereezort.com holds both Accounts User and Accounts Manager;
// the_reezort.account.api.ROLE_PRIORITY ranks Accounts Manager higher, so
// that's what the sidebar badge (primary_role) actually renders.
const DEMO_ROLE = "Accounts Manager";

async function login(page: Page): Promise<void> {
	await page.goto("/resort-app");
	await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText(DEMO_NAME).first()).toBeVisible({ timeout: 15000 });
}

test.describe("Accounts", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	// ── 1. Sidebar access control ────────────────────────────────────────────
	test("sidebar shows every allowed screen and hides restricted ones; role badge reads Accounts User", async ({ page }) => {
		// Allowed screens — must all be visible in the sidebar after login.
		await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Reservations" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Front desk" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Cashier close" })).toBeVisible();

		// Forbidden screens — must not appear in the sidebar for this role.
		await expect(page.getByRole("link", { name: "Restaurant mgmt" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Staff & access" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Maintenance" })).not.toBeVisible();

		// Role badge in the sidebar footer must identify this user correctly.
		await expect(page.getByTestId("user-role")).toHaveText(DEMO_ROLE);
	});

	// ── 2. Executive cockpit ─────────────────────────────────────────────────
	test("Executive cockpit loads without API errors", async ({ page }) => {
		const apiErrors: Array<{ url: string; status: number }> = [];
		page.on("response", (response) => {
			if (
				response.url().includes("/api/method/the_reezort") &&
				response.status() >= 400
			) {
				apiErrors.push({ url: response.url(), status: response.status() });
			}
		});

		await page.goto("/resort-app#/cockpit");
		await expect(
			page.getByRole("heading", { name: "Resort management cockpit." }),
		).toBeVisible();

		// Primary action: reload the SPA via the prototype link (idempotent).
		await page.getByRole("link", { name: "Refresh prototype" }).click();

		expect(
			apiErrors,
			`Unexpected API errors on /cockpit: ${JSON.stringify(apiErrors)}`,
		).toHaveLength(0);
	});

	// ── 3. Reservations ──────────────────────────────────────────────────────
	test("Reservations screen loads without API errors", async ({ page }) => {
		const apiErrors: Array<{ url: string; status: number }> = [];
		page.on("response", (response) => {
			if (
				response.url().includes("/api/method/the_reezort") &&
				response.status() >= 400
			) {
				apiErrors.push({ url: response.url(), status: response.status() });
			}
		});

		await page.goto("/resort-app#/reservations");
		await expect(page.getByRole("heading", { name: "Reservations" })).toBeVisible();

		// Primary action: type in the search box (non-mutating, triggers debounced server search).
		await page.getByTestId("reservations-search").fill("Smith");

		expect(
			apiErrors,
			`Unexpected API errors on /reservations: ${JSON.stringify(apiErrors)}`,
		).toHaveLength(0);
	});

	// ── 4. Front desk ────────────────────────────────────────────────────────
	test("Front desk screen loads without API errors", async ({ page }) => {
		const apiErrors: Array<{ url: string; status: number }> = [];
		page.on("response", (response) => {
			if (
				response.url().includes("/api/method/the_reezort") &&
				response.status() >= 400
			) {
				apiErrors.push({ url: response.url(), status: response.status() });
			}
		});

		await page.goto("/resort-app#/frontdesk");
		await expect(page.getByTestId("frontdesk-screen")).toBeVisible();

		// No safe idempotent primary action without seeded reservation/stay data.

		expect(
			apiErrors,
			`Unexpected API errors on /frontdesk: ${JSON.stringify(apiErrors)}`,
		).toHaveLength(0);
	});

	// ── 5. Billing ───────────────────────────────────────────────────────────
	test("Billing screen loads without API errors", async ({ page }) => {
		const apiErrors: Array<{ url: string; status: number }> = [];
		page.on("response", (response) => {
			if (
				response.url().includes("/api/method/the_reezort") &&
				response.status() >= 400
			) {
				apiErrors.push({ url: response.url(), status: response.status() });
			}
		});

		await page.goto("/resort-app#/billing");
		await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();

		// Primary action: switch to the Payments tab (non-mutating).
		await page.getByTestId("tab-payments").click();

		expect(
			apiErrors,
			`Unexpected API errors on /billing: ${JSON.stringify(apiErrors)}`,
		).toHaveLength(0);
	});

	// ── 6. Cashier close ─────────────────────────────────────────────────────
	test("Cashier close screen loads without API errors", async ({ page }) => {
		const apiErrors: Array<{ url: string; status: number }> = [];
		page.on("response", (response) => {
			if (
				response.url().includes("/api/method/the_reezort") &&
				response.status() >= 400
			) {
				apiErrors.push({ url: response.url(), status: response.status() });
			}
		});

		await page.goto("/resort-app#/cashier-close");
		await expect(page.getByRole("heading", { name: "Cashier Close" })).toBeVisible();

		// Primary action: open the Close type combobox (non-mutating, no selection made).
		await page.getByRole("combobox").first().click();

		expect(
			apiErrors,
			`Unexpected API errors on /cashier-close: ${JSON.stringify(apiErrors)}`,
		).toHaveLength(0);
	});
});
