import { test, expect, type Page } from "@playwright/test";

const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

async function login(page: Page, user = "gm@thereezort.com") {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(user);
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Attendance & Roster", () => {
	test("clock a staff member in and mark attendance from the board", async ({ page }) => {
		await login(page);
		await page.getByRole("link", { name: "Attendance" }).click();
		await expect(page).toHaveURL(/#\/attendance/);
		await expect(page.getByTestId("attendance-screen")).toBeVisible();

		// Clock the first staff member in → board shows an "In ·" badge.
		await page.locator('[data-testid^="clock-in-"]').first().click();
		await expect(page.getByText(/In ·/).first()).toBeVisible();

		// Mark the first staff member Present → "Present" badge appears.
		await page.locator('[data-testid^="mark-"]').first().click();
		await page.getByRole("option", { name: "Present" }).click();
		await expect(page.getByText("Present", { exact: true }).first()).toBeVisible();
	});
});
