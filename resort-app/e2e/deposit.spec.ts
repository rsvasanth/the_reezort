import { test, expect } from "@playwright/test";
const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";
test("record a deposit on an open folio (real Payment Entry)", async ({ page }) => {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill("gm@thereezort.com");
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
	await page.goto("/resort-app#/folio/RZ-FOL-2026-00002");
	await page.reload();
	await expect(page.getByTestId("folio-deposit")).toBeVisible();
	await page.getByTestId("folio-deposit").click();
	await expect(page.getByTestId("deposit-sheet")).toBeVisible();
	await page.getByTestId("deposit-amount").fill("1000");
	await page.getByTestId("deposit-save").click();
	await expect(page.getByText(/deposit recorded/i).first()).toBeVisible();
});
