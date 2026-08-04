import { test, expect, type Page } from "@playwright/test";
const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";
async function login(page: Page) {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill("gm@thereezort.com");
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}
function plusOneDay(iso: string): string {
	const d = new Date(iso + "T00:00:00");
	d.setDate(d.getDate() + 1);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
test("extend an in-house stay by one night", async ({ page }) => {
	await login(page);
	await page.getByRole("link", { name: "Front desk" }).click();
	await expect(page.getByTestId("frontdesk-screen")).toBeVisible();
	await page.locator('[data-testid^="extend-"]').first().click();
	await expect(page.getByTestId("extend-sheet")).toBeVisible();
	const cur = await page.getByTestId("extend-date").inputValue();
	await page.getByTestId("extend-date").fill(plusOneDay(cur));
	await page.getByTestId("extend-confirm").click();
	await expect(page.getByText(/stay extended/i).first()).toBeVisible();
});
