import { test, expect, type Page } from "@playwright/test";

const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

async function loginAs(page: Page, user: string) {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(user);
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Desk lock (SPA-first)", () => {
	test("operational role sees NO desk affordance (sidebar link or dashboard button)", async ({ page }) => {
		await loginAs(page, "housekeeping@thereezort.com");
		// Give the profile a beat to load, then assert no /app affordance anywhere.
		await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
		await expect(page.getByText(/ERPNext desk/i)).toHaveCount(0);
		await expect(page.locator('a[href="/app"]')).toHaveCount(0);
	});

	test("manager (GM) keeps the ERPNext desk affordance", async ({ page }) => {
		await loginAs(page, "gm@thereezort.com");
		await expect(page.locator('a[href="/app"]').first()).toBeVisible();
	});
});
