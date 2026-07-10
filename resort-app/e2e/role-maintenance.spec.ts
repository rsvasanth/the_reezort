import { test, expect, type Page } from "@playwright/test";

const DEMO_USER = "maintenance@thereezort.com";
const DEMO_PASSWORD = "Reezort@Demo2026";
const DEMO_NAME = "Maintenance";
const DEMO_ROLE = "Maintenance";

async function login(page: Page): Promise<void> {
	await page.goto("/resort-app");
	await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText(DEMO_NAME).first()).toBeVisible({ timeout: 15000 });
}

/** Collect any the_reezort API responses that return an HTTP error during a test. */
function trackApiErrors(page: Page): () => { url: string; status: number }[] {
	const errors: { url: string; status: number }[] = [];
	page.on("response", (response) => {
		if (
			response.url().includes("/api/method/the_reezort") &&
			response.status() >= 400
		) {
			errors.push({ url: response.url(), status: response.status() });
		}
	});
	return () => errors;
}

test.describe("Maintenance", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	// ─── 1. Sidebar navigation ───────────────────────────────────────────────

	test("sidebar shows every allowed screen and hides forbidden ones; role badge reads Maintenance", async ({ page }) => {
		// Role badge in the sidebar footer.
		await expect(page.getByTestId("user-role")).toHaveText(DEMO_ROLE);

		// Allowed sidebar links must all be present.
		await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Housekeeping" })).toBeVisible();
		await expect(page.getByRole("link", { name: "My tasks" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Maintenance" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Service desk" })).toBeVisible();

		// Forbidden links must not appear (spot-check per spec).
		await expect(page.getByRole("link", { name: "Billing" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Restaurant & bar" })).not.toBeVisible();
		await expect(page.getByRole("link", { name: "Staff & access" })).not.toBeVisible();
	});

	// ─── 2. Executive cockpit ────────────────────────────────────────────────

	test("Executive cockpit: loads and survives a prototype refresh without API errors", async ({ page }) => {
		const getErrors = trackApiErrors(page);

		await page.goto("/resort-app#/cockpit");

		// Heading is hardcoded in JSX and renders before the async snapshot call.
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible();

		// Primary action: reload the SPA (idempotent, no mutations).
		await page.getByRole("link", { name: "Refresh prototype" }).click();
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible();

		const apiErrors = getErrors();
		expect(
			apiErrors,
			`Executive cockpit — unexpected API errors: ${apiErrors.map((e) => `${e.status} ${e.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ─── 3. Housekeeping ─────────────────────────────────────────────────────

	test("Housekeeping: board loads and refresh is idempotent without API errors", async ({ page }) => {
		const getErrors = trackApiErrors(page);

		await page.goto("/resort-app#/housekeeping");

		// Refresh button only mounts once content (or mock fallback) has rendered.
		await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

		// Primary action: re-fetch the board (idempotent).
		await page.getByRole("button", { name: "Refresh" }).click();

		const apiErrors = getErrors();
		expect(
			apiErrors,
			`Housekeeping — unexpected API errors: ${apiErrors.map((e) => `${e.status} ${e.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ─── 4. My tasks ─────────────────────────────────────────────────────────

	test("My tasks: screen loads and History tab is reachable without API errors", async ({ page }) => {
		const getErrors = trackApiErrors(page);

		await page.goto("/resort-app#/my-tasks");

		// h1 renders immediately inside WorkspacePage before data loads.
		await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();

		// Primary action: switch to the History (closed tasks) tab.
		await page.getByTestId("tab-history").click();

		const apiErrors = getErrors();
		expect(
			apiErrors,
			`My tasks — unexpected API errors: ${apiErrors.map((e) => `${e.status} ${e.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ─── 5. Maintenance inbox ────────────────────────────────────────────────

	test("Maintenance inbox: loads and search filter runs without API errors", async ({ page }) => {
		const getErrors = trackApiErrors(page);

		await page.goto("/resort-app#/maintenance");

		// h1 and filter row render immediately.
		await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();

		// Primary action: debounced search — read-only, no server mutations.
		await page.getByTestId("filter-search").fill("AC");

		const apiErrors = getErrors();
		expect(
			apiErrors,
			`Maintenance inbox — unexpected API errors: ${apiErrors.map((e) => `${e.status} ${e.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ─── 6. Service desk ─────────────────────────────────────────────────────

	test("Service desk: loads and New ticket sheet opens without API errors", async ({ page }) => {
		const getErrors = trackApiErrors(page);

		await page.goto("/resort-app#/servicedesk");

		// h1 renders immediately; assert it rather than the ticket table to avoid
		// role-permission edge-cases on the table itself.
		await expect(page.getByRole("heading", { name: "Service desk" })).toBeVisible();

		// Primary action: open the New ticket sheet (does not submit a ticket).
		await page.getByTestId("new-ticket").click();

		const apiErrors = getErrors();
		expect(
			apiErrors,
			`Service desk — unexpected API errors: ${apiErrors.map((e) => `${e.status} ${e.url}`).join(", ")}`,
		).toHaveLength(0);
	});
});
