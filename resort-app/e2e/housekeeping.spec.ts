import { test, expect } from "@playwright/test";

const DEMO_USER = process.env.E2E_USER ?? "gm@thereezort.com";
const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

async function login(page: import("@playwright/test").Page) {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Housekeeping", () => {
	test("board opens from the sidebar and renders rooms", async ({ page }) => {
		await login(page);

		// Navigate via the sidebar (real user path).
		await page.getByRole("link", { name: "Housekeeping" }).click();
		await expect(page).toHaveURL(/#\/housekeeping/);

		// We left the dashboard.
		await expect(page.getByRole("heading", { name: /Resort management cockpit/i })).toHaveCount(0);

		// Board chrome + at least one room's housekeeping status badge.
		await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
		await expect(
			page
				.getByText(/Clean|Dirty|Inspected|In Progress|Pickup|Turndown|Out of Service/)
				.first()
		).toBeVisible();
	});
});
