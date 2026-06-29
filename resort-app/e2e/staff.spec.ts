import { test, expect, type Page } from "@playwright/test";

const DEMO_USER = process.env.E2E_USER ?? "gm@thereezort.com";
const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";
const NEW_STAFF = "zz.e2estaff@thereezort.com";

async function login(page: Page) {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Staff & Access", () => {
	test("onboard a staff login with a role from the SPA", async ({ page }) => {
		await login(page);
		await page.getByRole("link", { name: "Staff & access" }).click();
		await expect(page).toHaveURL(/#\/staff/);
		await expect(page.getByTestId("staff-screen")).toBeVisible();

		await page.getByTestId("add-staff").click();
		await expect(page.getByTestId("staff-sheet")).toBeVisible();
		await page.getByTestId("f-staff-email").fill(NEW_STAFF);
		await page.getByTestId("f-staff-firstname").fill("ZZ E2E");
		await page.getByTestId("f-staff-password").fill("Reezort@E2E1");
		await page.getByTestId("role-Front-Desk").getByRole("checkbox").click();
		await page.getByTestId("staff-save").click();

		// The new staff member appears in the directory with the role.
		const row = page.getByTestId(`staff-row-${NEW_STAFF}`);
		await expect(row).toBeVisible();
		await expect(row.getByText("Front Desk")).toBeVisible();
	});
});
