import { test, expect, type Page } from "@playwright/test";

const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";
const GUEST = "E2E Booking Guest";

async function login(page: Page, user = "gm@thereezort.com") {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(user);
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Reservations", () => {
	test("book a stay: search availability → select → guest → confirm", async ({ page }) => {
		await login(page);
		await page.getByRole("link", { name: "Reservations" }).click();
		await expect(page).toHaveURL(/#\/reservations/);
		await expect(page.getByTestId("reservations-screen")).toBeVisible();

		await page.getByTestId("new-booking").click();
		await expect(page.getByTestId("booking-sheet")).toBeVisible();

		// Search availability.
		await page.getByTestId("b-search").click();
		await expect(page.getByTestId("offers")).toBeVisible();

		// Pick the first offered room type.
		const firstOffer = page.locator('[data-testid^="offer-"]').first();
		await expect(firstOffer).toBeVisible();
		await firstOffer.click();

		// Guest details → confirm.
		await page.getByTestId("b-guest-name").fill(GUEST);
		await page.getByTestId("b-confirm").click();

		// Confirmed booking appears in the pipeline.
		await expect(page.getByText("Booking confirmed").first()).toBeVisible();
		const row = page.locator('[data-testid^="res-"]').filter({ hasText: GUEST });
		await expect(row).toBeVisible();
		await expect(row.getByText("Confirmed")).toBeVisible();
	});
});
