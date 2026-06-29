import { test, expect, type Page } from "@playwright/test";

const DEMO_USER = process.env.E2E_USER ?? "gm@thereezort.com";
const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

// Fixed test code → the wizard reuses on re-run (idempotent), so the suite is repeatable.
const CODE = "ZZ-E2E";

async function login(page: Page) {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Property Setup", () => {
	test("wizard onboards a property end to end: property → building → floor → type → rooms", async ({
		page,
	}) => {
		await login(page);
		await page.getByRole("link", { name: "Property setup" }).click();
		await expect(page).toHaveURL(/#\/setup/);
		await expect(page.getByTestId("setup-screen")).toBeVisible();

		// Step 1 — Property (company/timezone/currency pre-filled from options).
		await page.getByTestId("f-property-name").fill("ZZ E2E Resort");
		await page.getByTestId("f-property-code").fill(CODE);
		await page.getByTestId("setup-next").click();
		await expect(page.getByTestId("setup-step-title")).toContainText("Building");

		// Step 2 — Building
		await page.getByTestId("f-building-name").fill("E2E Block");
		await page.getByTestId("f-building-code").fill("E2EB");
		await page.getByTestId("setup-next").click();
		await expect(page.getByTestId("setup-step-title")).toContainText("Floor");

		// Step 3 — Floor
		await page.getByTestId("f-floor-label").fill("E2E Floor 9");
		await page.getByTestId("f-floor-code").fill("9");
		await page.getByTestId("setup-next").click();
		await expect(page.getByTestId("setup-step-title")).toContainText("Room Type");

		// Step 4 — Room Type
		await page.getByTestId("f-roomtype-name").fill("E2E Deluxe");
		await page.getByTestId("f-roomtype-code").fill("E2EDLX");
		await page.getByTestId("f-roomtype-adults").fill("2");
		await page.getByTestId("f-roomtype-max").fill("3");
		await page.getByTestId("setup-next").click();
		await expect(page.getByTestId("setup-step-title")).toContainText("Rooms");

		// Step 5 — Rooms (bulk)
		await page.getByTestId("f-room-start").fill("9101");
		await page.getByTestId("f-room-count").fill("3");
		await expect(page.getByTestId("room-preview")).toContainText("9103");
		await page.getByTestId("setup-next").click();

		// Step 6 — Review: every create succeeded if we reach the summary.
		await expect(page.getByTestId("setup-summary")).toBeVisible();
		await expect(page.getByTestId("setup-summary")).toContainText("Property is ready");
		await expect(page.getByTestId("setup-summary")).toContainText("Rooms");
	});
});
