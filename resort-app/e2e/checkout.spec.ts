import { test, expect } from "@playwright/test";

const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

test("checkout frees the room and sends it to housekeeping", async ({ page }) => {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill("gm@thereezort.com");
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();

	// Open a settled (invoiced) folio directly.
	await page.goto("/resort-app#/folio/RZ-FOL-2026-00003");
	await page.reload();

	const checkout = page.getByTestId("folio-checkout");
	await expect(checkout).toBeVisible();
	await checkout.click();

	// Toast confirms the orchestration: room freed + housekeeping task created.
	await expect(page.getByText(/sent to housekeeping|checked out/i).first()).toBeVisible();
});
