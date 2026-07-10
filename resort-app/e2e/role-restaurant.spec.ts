import { test, expect } from "@playwright/test";

const DEMO_USER = "restaurant@thereezort.com";
const DEMO_PASSWORD = "Reezort@Demo2026";
const DEMO_NAME = "Restaurant";
const DEMO_ROLE = "Restaurant";

async function login(page: import("@playwright/test").Page): Promise<void> {
	await page.goto("/resort-app");
	await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText(DEMO_NAME).first()).toBeVisible({ timeout: 15000 });
}

test.describe("Restaurant", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	// ── 1. Sidebar visibility + role badge ─────────────────────────────────────

	test("sidebar shows allowed screens, hides forbidden ones, and role badge is correct", async ({ page }) => {
		// Role badge in the sidebar footer must read "Restaurant".
		await expect(page.getByTestId("user-role")).toHaveText(DEMO_ROLE);

		// Allowed sidebar links.
		await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Restaurant & bar" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Restaurant mgmt" })).toBeVisible();

		// Forbidden sidebar links must not appear.
		await expect(page.getByRole("link", { name: "Housekeeping" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Billing" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Staff & access" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Maintenance" })).not.toBeVisible();
	});

	// ── 2. Per-screen tests ────────────────────────────────────────────────────

	test("Executive cockpit: loads and survives primary action", async ({ page }) => {
		const apiErrors: { url: string; status: number }[] = [];
		page.on("response", (response) => {
			if (response.url().includes("/api/method/the_reezort") && response.status() >= 400) {
				apiErrors.push({ url: response.url(), status: response.status() });
			}
		});

		await page.goto("/resort-app#/cockpit");

		// The h1 is hardcoded and renders before the async snapshot call resolves.
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible();

		// Primary action: Refresh prototype link reloads the SPA (idempotent).
		await page.getByRole("link", { name: "Refresh prototype" }).click();
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible();

		expect(
			apiErrors,
			`API errors on Executive cockpit:\n${apiErrors.map((e) => `  ${e.status} ${e.url}`).join("\n")}`,
		).toHaveLength(0);
	});

	test("Restaurant & bar: loads and survives primary action", async ({ page }) => {
		const apiErrors: { url: string; status: number }[] = [];
		page.on("response", (response) => {
			if (response.url().includes("/api/method/the_reezort") && response.status() >= 400) {
				apiErrors.push({ url: response.url(), status: response.status() });
			}
		});

		await page.goto("/resort-app#/restaurant");

		// Floor plan heading renders immediately (before API or mock data arrives).
		await expect(page.getByRole("heading", { name: "Floor plan" })).toBeVisible();

		// Primary action: open the outlet picker dropdown.
		await page.getByTestId("restaurant-outlet").click();

		expect(
			apiErrors,
			`API errors on Restaurant & bar:\n${apiErrors.map((e) => `  ${e.status} ${e.url}`).join("\n")}`,
		).toHaveLength(0);
	});

	test("Restaurant mgmt: loads and survives primary action", async ({ page }) => {
		const apiErrors: { url: string; status: number }[] = [];
		page.on("response", (response) => {
			if (response.url().includes("/api/method/the_reezort") && response.status() >= 400) {
				apiErrors.push({ url: response.url(), status: response.status() });
			}
		});

		await page.goto("/resort-app#/restaurant/management");

		// The outer heading and <main> render immediately, before tab/outlet data loads.
		await expect(page.getByRole("heading", { name: "Restaurant management" })).toBeVisible();

		// Primary action: switch to the Calendar tab (read-only, no mutations).
		await page.getByRole("tab", { name: "Calendar" }).click();

		expect(
			apiErrors,
			`API errors on Restaurant mgmt:\n${apiErrors.map((e) => `  ${e.status} ${e.url}`).join("\n")}`,
		).toHaveLength(0);
	});
});
