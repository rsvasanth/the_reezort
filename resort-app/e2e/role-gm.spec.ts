import { test, expect, Page } from "@playwright/test";

const DEMO_USER = "gm@thereezort.com";
const DEMO_PASSWORD = "Reezort@Demo2026";
const DEMO_NAME = "General Manager";
const DEMO_ROLE = "Resort Manager";

async function login(page: Page): Promise<void> {
	await page.goto("/resort-app");
	await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
	await page.getByLabel("Email").fill(DEMO_USER);
	await page.getByLabel("Password").fill(DEMO_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByText(DEMO_NAME).first()).toBeVisible({ timeout: 15000 });
}

/** Collect every /api/method/the_reezort response with status >= 400 after registration. */
function trackApiErrors(page: Page): { collect: () => Array<{ url: string; status: number }> } {
	const failures: Array<{ url: string; status: number }> = [];
	page.on("response", (response) => {
		if (response.url().includes("/api/method/the_reezort") && response.status() >= 400) {
			failures.push({ url: response.url(), status: response.status() });
		}
	});
	return {
		collect: () => failures,
	};
}

test.describe("General Manager", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	// ── 1. Sidebar visibility & role badge ──────────────────────────────────
	test("sidebar shows every allowed screen link and role badge reads Resort Manager", async ({ page }) => {
		// Role badge in the sidebar footer.
		await expect(page.getByTestId("user-role")).toHaveText(DEMO_ROLE);

		// General Manager (Resort Manager role) maps to null allowedSidebarTitles —
		// every live sidebar item must be visible with no filtering applied.
		await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Reservations" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Front desk" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Housekeeping" })).toBeVisible();
		await expect(page.getByRole("link", { name: "My tasks" })).toBeVisible();
		await expect(page.getByRole("link", { name: "All tasks" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Cashier close" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Restaurant & bar" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Restaurant mgmt" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Maintenance" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Service desk" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Property management" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Staff & access" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Attendance" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Approvals" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Audit trail" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Integrations" })).toBeVisible();
	});

	// ── 2. Executive cockpit ─────────────────────────────────────────────────
	test("Executive cockpit loads without API errors and accepts a Refresh prototype click", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/cockpit");

		// Loaded assertion: h1 is hardcoded in JSX and renders before the async
		// getManagementDashboardSnapshot() call resolves.
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible();

		// Primary action: Refresh prototype link reloads the SPA — idempotent.
		await page.getByRole("link", { name: "Refresh prototype" }).click();

		// Allow the page to settle after the SPA reload.
		await expect(page.getByRole("heading", { name: "Resort management cockpit." })).toBeVisible({ timeout: 15000 });

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /cockpit: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 3. Reservations ──────────────────────────────────────────────────────
	test("Reservations screen loads without API errors and accepts a search query", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/reservations");

		// Loaded assertion: h1 comes from WorkspacePage before listReservations() resolves.
		await expect(page.getByRole("heading", { name: "Reservations" })).toBeVisible();

		// Primary action: fill the search box (350 ms debounce, server-side, non-mutating).
		await page.getByTestId("reservations-search").fill("Smith");

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /reservations: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 4. Front desk ────────────────────────────────────────────────────────
	test("Front desk screen loads without API errors", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/frontdesk");

		// Loaded assertion: data-testid='frontdesk-screen' is placed on the
		// motion.main element and renders synchronously before getFrontDeskBoard().
		await expect(page.getByTestId("frontdesk-screen")).toBeVisible();

		// No safe idempotent primary action exists without seeded data.

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /frontdesk: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 5. Housekeeping ──────────────────────────────────────────────────────
	test("Housekeeping board loads without API errors and accepts a Refresh click", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/housekeeping");

		// Loaded assertion: Refresh button only mounts once snapshotState leaves 'loading'.
		await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible({ timeout: 15000 });

		// Primary action: re-trigger the board fetch — fully idempotent.
		await page.getByRole("button", { name: "Refresh" }).click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /housekeeping: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 6. My tasks ──────────────────────────────────────────────────────────
	test("My tasks screen loads without API errors and switches to History tab", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/my-tasks");

		// Loaded assertion: h1 renders immediately inside WorkspacePage.
		await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();

		// Primary action: switch to the History tab (non-mutating tab change).
		await page.getByTestId("tab-history").click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /my-tasks: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 7. All tasks ─────────────────────────────────────────────────────────
	test("All tasks (Task ledger) screen loads without API errors and accepts a filter query", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/tasks");

		// Loaded assertion: WorkspacePage title prop is 'Task ledger', not 'All tasks'.
		await expect(page.getByRole("heading", { name: "Task ledger" })).toBeVisible();

		// Primary action: fill the search input (client-side filter, non-mutating).
		await page.getByPlaceholder("Room, type, assignee…").fill("101");

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /tasks: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 8. Billing ───────────────────────────────────────────────────────────
	test("Billing screen loads without API errors and switches to Payments tab", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/billing");

		// Loaded assertion: h1 and data-testid='billing-screen' render before the API call.
		await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();

		// Primary action: switch to the Payments tab (non-mutating).
		await page.getByTestId("tab-payments").click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /billing: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 9. Cashier close ─────────────────────────────────────────────────────
	test("Cashier close screen loads without API errors and opens the Close type combobox", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/cashier-close");

		// Loaded assertion: h1 renders immediately, no data dependency.
		await expect(page.getByRole("heading", { name: "Cashier Close" })).toBeVisible();

		// Primary action: open the Close type combobox in the 'Open a shift' card (non-mutating).
		await page.getByRole("combobox").first().click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /cashier-close: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 10. Restaurant & bar ─────────────────────────────────────────────────
	test("Restaurant & bar floor plan loads without API errors and opens the outlet picker", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/restaurant");

		// Loaded assertion: h1 and outlet Select render before any API data arrives.
		await expect(page.getByRole("heading", { name: "Floor plan" })).toBeVisible();

		// Primary action: click the outlet Select to open the picker dropdown (non-mutating).
		await page.getByTestId("restaurant-outlet").click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /restaurant: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 11. Restaurant mgmt ──────────────────────────────────────────────────
	test("Restaurant management screen loads without API errors and switches to Calendar tab", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/restaurant/management");

		// Loaded assertion: outer <main data-testid='restaurant-management'> and h1 render immediately.
		await expect(page.getByRole("heading", { name: "Restaurant management" })).toBeVisible();

		// Primary action: switch to the Calendar tab (non-mutating, no mutations).
		await page.getByRole("tab", { name: "Calendar" }).click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /restaurant/management: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 12. Maintenance ──────────────────────────────────────────────────────
	test("Maintenance inbox loads without API errors and accepts a search filter", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/maintenance");

		// Loaded assertion: h1 and filter row render immediately.
		await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();

		// Primary action: fill the debounced search filter (read-only, no mutation).
		await page.getByTestId("filter-search").fill("AC");

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /maintenance: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 13. Service desk ─────────────────────────────────────────────────────
	test("Service desk loads without API errors and opens the New ticket sheet", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/servicedesk");

		// Loaded assertion: h1 renders immediately.
		await expect(page.getByRole("heading", { name: "Service desk" })).toBeVisible();

		// Primary action: open NewTicketSheet without submitting (no API mutation).
		await page.getByTestId("new-ticket").click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /servicedesk: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 14. Analytics — Revenue ──────────────────────────────────────────────
	test("Revenue analytics dashboard loads without API errors and changes the date range", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/analytics/revenue");

		// Loaded assertion: h1 'Revenue' doubles as a data-loaded check — it is
		// absent during the loading state which only renders Skeleton elements.
		// exact: true avoids matching the "Daily revenue" h2 (substring match).
		await expect(page.getByRole("heading", { name: "Revenue", exact: true })).toBeVisible({ timeout: 15000 });

		// Primary action: change the date range (no mutation). range-picker is a
		// native <select> (Carbon's Select renders one) — selectOption(), not
		// click-then-click-option, which only applies to ARIA listboxes.
		await page.getByTestId("range-picker").selectOption({ label: "Last 7 days" });

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /analytics/revenue: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 15. Property management ──────────────────────────────────────────────
	test("Property management screen loads without API errors and opens the Guided onboard wizard", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/setup");

		// Loaded assertion: h1 and Guided onboard button render before API data arrives.
		await expect(page.getByRole("heading", { name: "Properties & rooms" })).toBeVisible();

		// Primary action: enter the PropertySetupScreen wizard sub-view (non-mutating navigation).
		await page.getByTestId("guided-onboard").click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /setup: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 16. Staff & access ───────────────────────────────────────────────────
	test("Staff & access screen loads without API errors and opens the Add staff sheet", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/staff");

		// Loaded assertion: h1 renders immediately regardless of loading or auth state.
		await expect(page.getByRole("heading", { name: "Staff & access" })).toBeVisible();

		// Primary action: open the StaffSheet side-drawer without creating any record.
		await page.getByTestId("add-staff").click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /staff: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 17. Attendance ───────────────────────────────────────────────────────
	test("Attendance screen loads without API errors and changes the roster date", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/attendance");

		// Loaded assertion: h1 and Tabs strip render immediately before any API call.
		await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();

		// Primary action: change the roster date to a fixed historical value — safe refetch, no mutation.
		await page.getByTestId("attendance-date").fill("2026-01-01");

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /attendance: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 18. Approvals ────────────────────────────────────────────────────────
	test("Approvals inbox loads without API errors and switches to My requests tab", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/approvals");

		// Loaded assertion: h1 and TabsList (inbox-tabs) render immediately before data arrives.
		await expect(page.getByRole("heading", { name: "Approvals inbox" })).toBeVisible();

		// Primary action: switch to the 'My requests' tab (non-mutating).
		await page.getByRole("tab", { name: "My requests" }).click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /approvals: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 19. Audit trail ──────────────────────────────────────────────────────
	test("Audit trail screen loads without API errors and accepts an actor filter", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/audit");

		// Loaded assertion: h1 and filter card render immediately with no data dependency.
		await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();

		// Primary action: type in the actor filter — does not auto-submit, no mutation.
		await page.getByTestId("filter-actor").fill("admin@thereezort.com");

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /audit: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});

	// ── 20. Integrations — OTA Inbox ─────────────────────────────────────────
	test("OTA reservations inbox loads without API errors and toggles the New KPI filter", async ({ page }) => {
		const tracker = trackApiErrors(page);

		await page.goto("/resort-app#/integrations/ota-inbox");

		// Loaded assertion: h1 renders immediately; KPI tiles default to 0 until the API resolves.
		await expect(page.getByRole("heading", { name: "OTA reservations" })).toBeVisible();

		// Primary action: click the 'New' KPI tile to apply the state filter (idempotent toggle).
		await page.getByTestId("kpi-New").click();

		const failures = tracker.collect();
		expect(
			failures,
			`API errors on /integrations/ota-inbox: ${failures.map((f) => `${f.status} ${f.url}`).join(", ")}`,
		).toHaveLength(0);
	});
});
