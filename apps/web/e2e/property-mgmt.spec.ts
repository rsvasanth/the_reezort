import { test, expect, type Page } from "@playwright/test";

const DEMO_USER = process.env.E2E_USER ?? "gm@thereezort.com";
const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";

async function login(page: Page) {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Property Management console", () => {
	test("add equipment type, then track it with condition on a room", async ({ page }) => {
		await login(page);
		await page.getByRole("link", { name: "Property management" }).click();
		await expect(page).toHaveURL(/#\/setup/);
		await expect(page.getByTestId("property-mgmt")).toBeVisible();

		// Equipment catalog → add an equipment type.
		await page.getByRole("tab", { name: "Equipment catalog" }).click();
		await page.getByTestId("amenity-name").fill("E2E AC Unit");
		await page.getByTestId("amenity-code").fill("E2EAC");
		await page.getByTestId("add-amenity").click();
		await expect(page.getByTestId("amenity-E2EAC")).toBeVisible();

		// Rooms → open a room → add an equipment item with a condition → save.
		await page.getByTestId("tab-rooms").click();
		await page.getByTestId("edit-102").click();
		await expect(page.getByTestId("room-sheet")).toBeVisible();
		await page.getByTestId("add-equipment").click();
		await expect(page.getByLabel("Remove equipment")).toBeVisible();
		await page.getByTestId("room-save").click();

		// Re-open the room: the equipment persisted (no longer the empty state).
		await expect(page.getByTestId("room-sheet")).toBeHidden();
		await page.getByTestId("edit-102").click();
		await expect(page.getByTestId("room-sheet")).toBeVisible();
		await expect(page.getByLabel("Remove equipment")).toBeVisible();
	});
});
