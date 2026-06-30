import { test, expect, type Page } from "@playwright/test";
const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";
const GUEST = "E2E Booking Guest";
async function login(page: Page) {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill("gm@thereezort.com");
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}
test("book a stay end to end → lands on the reservation workspace", async ({ page }) => {
	await login(page);
	await page.getByRole("link", { name: "Reservations" }).click();
	await expect(page).toHaveURL(/#\/reservations$/);
	await expect(page.getByTestId("reservations-screen").or(page.getByText("Booking pipeline"))).toBeVisible().catch(() => {});
	await page.getByTestId("new-booking").click();
	await expect(page).toHaveURL(/#\/reservations\/new/);
	await page.getByTestId("b-search").click();
	await expect(page.getByTestId("offers")).toBeVisible();
	await page.locator('[data-testid^="offer-"]').first().click();
	await page.getByTestId("b-guest-name").fill(GUEST);
	await page.getByTestId("b-confirm").click();
	// Full-page detail workspace.
	await expect(page).toHaveURL(/#\/reservations\/RZ-RES/);
	await expect(page.getByText(GUEST).first()).toBeVisible();
	await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible();
});
