import { test, expect, type Page } from "@playwright/test";

const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

async function login(page: Page, user = "gm@thereezort.com") {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(user);
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Billing", () => {
	test("billing overview shows summary + invoices ledger", async ({ page }) => {
		await login(page);
		await page.getByRole("link", { name: "Billing" }).click();
		await expect(page).toHaveURL(/#\/billing/);
		await expect(page.getByTestId("billing-screen")).toBeVisible();

		// Summary tiles render (scope to the summary to avoid the table header collision).
		const summary = page.getByTestId("billing-summary");
		await expect(summary).toBeVisible();
		await expect(summary.getByText("Invoiced")).toBeVisible();
		await expect(summary.getByText("Collected")).toBeVisible();

		// Invoices tab shows a real settled invoice.
		await expect(page.getByText(/ACC-SINV/).first()).toBeVisible();
		await expect(page.getByText("Unpaid").first()).toBeVisible();
	});
});
