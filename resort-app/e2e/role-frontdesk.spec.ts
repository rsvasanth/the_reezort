import { test, expect, type Page } from "@playwright/test";

const DEMO_USER = "frontdesk@thereezort.com";
const DEMO_PASSWORD = "Reezort@Demo2026";
const DEMO_NAME = "Front Desk";
const DEMO_ROLE = "Front Desk";

async function login(page: Page): Promise<void> {
	await page.goto("/resort-app");
	await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText(DEMO_NAME).first()).toBeVisible({ timeout: 15000 });
}

function collectApiErrors(page: Page): { url: string; status: number }[] {
	const errors: { url: string; status: number }[] = [];
	page.on("response", (response) => {
		if (response.url().includes("/api/method/the_reezort") && response.status() >= 400) {
			errors.push({ url: response.url(), status: response.status() });
		}
	});
	return errors;
}

function apiErrorMessage(errors: { url: string; status: number }[]): string {
	return `Unexpected API errors: ${errors.map((e) => `${e.status} ${e.url}`).join(", ")}`;
}

test.describe("Front Desk", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("sidebar shows all allowed links and hides forbidden ones; role badge reads Front Desk", async ({ page }) => {
		// Role badge in the sidebar footer must identify this user's role.
		await expect(page.getByTestId("user-role")).toHaveText(DEMO_ROLE);

		// Every screen this role is permitted to reach must appear in the sidebar.
		await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Reservations" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Front desk" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Housekeeping" })).toBeVisible();
		await expect(page.getByRole("link", { name: "All tasks" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Cashier close" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Maintenance" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Service desk" })).toBeVisible();

		// Manager-only / forbidden screens must not be visible to this role.
		await expect(page.getByRole("link", { name: "Restaurant mgmt" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Staff & access" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Audit trail" })).not.toBeVisible();
	});

	test("Executive cockpit — heading renders and Refresh prototype link is present", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/cockpit");
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible();
		// Primary action: reload the SPA via the Refresh prototype link (idempotent).
		await page.getByRole("link", { name: "Refresh prototype" }).click();
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});

	test("Reservations — list renders and search input accepts a query", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/reservations");
		await expect(page.getByRole("heading", { name: "Reservations" })).toBeVisible();
		// Primary action: fill the debounced server-side search (read-only, no mutation).
		await page.getByTestId("reservations-search").fill("Smith");
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});

	test("Front desk — board renders with Arrivals and In-house sections", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/frontdesk");
		await expect(page.getByTestId("frontdesk-screen")).toBeVisible();
		// Both section headings render synchronously before the API call resolves.
		await expect(page.getByText("Arrivals")).toBeVisible();
		await expect(page.getByText("In-house")).toBeVisible();
		// No safe idempotent primary action without seeded reservation/stay data.
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});

	test("Housekeeping — board renders and Refresh button is interactive", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/housekeeping");
		// The Refresh button only mounts after the board has fully settled (live or fallback).
		await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
		// Primary action: trigger an idempotent re-fetch.
		await page.getByRole("button", { name: "Refresh" }).click();
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});

	test("All tasks — task ledger renders and search filter accepts input", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/tasks");
		// WorkspacePage h1 is "Task ledger", not "All tasks".
		await expect(page.getByRole("heading", { name: "Task ledger" })).toBeVisible();
		// Primary action: fill the search input (client-side filter, no mutation).
		await page.getByPlaceholder("Room, type, assignee…").fill("101");
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});

	test("Billing — overview renders and Payments tab is clickable", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/billing");
		// h1 renders before the getBillingOverview() API call resolves.
		await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
		// Primary action: switch to the Payments tab (read-only navigation).
		await page.getByTestId("tab-payments").click();
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});

	test("Cashier close — screen renders and shift type combobox is present", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/cashier-close");
		await expect(page.getByRole("heading", { name: "Cashier Close" })).toBeVisible();
		// Primary action: open the Close type combobox without submitting the shift.
		await page.getByRole("combobox").first().click();
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});

	test("Maintenance — inbox renders and search filter accepts input", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/maintenance");
		await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();
		// Primary action: fill the debounced search (read-only, no ticket mutations).
		await page.getByTestId("filter-search").fill("AC");
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});

	test("Service desk — screen renders and New ticket sheet opens without submitting", async ({ page }) => {
		const apiErrors = collectApiErrors(page);
		await page.goto("/resort-app#/servicedesk");
		await expect(page.getByRole("heading", { name: "Service desk" })).toBeVisible();
		// Primary action: open NewTicketSheet — the sheet opens but nothing is submitted.
		await page.getByTestId("new-ticket").click();
		expect(apiErrors, apiErrorMessage(apiErrors)).toHaveLength(0);
	});
});
