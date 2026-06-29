import { test, expect } from "@playwright/test";

const DEMO_USER = process.env.E2E_USER ?? "gm@thereezort.com";
const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

test.describe("Auth", () => {
	test("login lands on the workspace, then logout returns to sign-in", async ({ page }) => {
		// Start unauthenticated -> login screen.
		await page.goto("/resort-app");
		await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

		// Sign in.
		await page.getByLabel("Email").fill(DEMO_USER);
		await page.getByLabel("Password").fill(DEMO_PASSWORD);
		await page.getByRole("button", { name: "Sign in" }).click();

		// Login reloads; the workspace shell should appear.
		await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();

		// Identity is shown in the sidebar footer.
		await expect(page.getByText(DEMO_USER).first()).toBeVisible();

		// Log out via the user menu.
		await page.getByRole("button", { name: new RegExp(DEMO_USER, "i") }).first().click();
		await page.getByRole("menuitem", { name: "Log out" }).click();

		// Back to the sign-in screen.
		await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
	});

	test("invalid credentials keep the user on the login screen", async ({ page }) => {
		await page.goto("/resort-app");
		await page.getByLabel("Email").fill(DEMO_USER);
		await page.getByLabel("Password").fill("wrong-password");
		await page.getByRole("button", { name: "Sign in" }).click();

		// Still on login; a failure toast appears.
		await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
		await expect(page.getByText(/Sign in failed/i)).toBeVisible();
	});
});
