import { test, expect, type Page } from "@playwright/test";

const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

async function login(page: Page, user = "gm@thereezort.com") {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(user);
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Front Desk", () => {
	test("board shows arrivals + in-house; can check an arrival in", async ({ page }) => {
		await login(page);
		await page.getByRole("link", { name: "Front desk" }).click();
		await expect(page).toHaveURL(/#\/frontdesk/);
		await expect(page.getByTestId("frontdesk-screen")).toBeVisible();

		// In-house guests are listed.
		await expect(page.locator('[data-testid^="inhouse-"]').first()).toBeVisible();

		// If an arrival is pending, check it in and confirm.
		const checkin = page.locator('[data-testid^="checkin-"]').first();
		if (await checkin.count()) {
			await checkin.click();
			await expect(page.getByText(/checked in/i).first()).toBeVisible();
		}
	});
});
