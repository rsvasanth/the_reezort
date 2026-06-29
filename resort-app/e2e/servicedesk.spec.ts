import { test, expect, type Page } from "@playwright/test";

const PWD = process.env.E2E_PASSWORD ?? "Reezort@Demo2026";
const SUBJECT = "E2E AC not cooling 204";

async function login(page: Page, user = "gm@thereezort.com") {
	await page.goto("/resort-app");
	await page.getByLabel("Email").fill(user);
	await page.getByLabel("Password").fill(PWD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("link", { name: "Executive cockpit" })).toBeVisible();
}

test.describe("Service Desk", () => {
	test("raise a ticket with SLA and assign it", async ({ page }) => {
		await login(page);
		await page.getByRole("link", { name: "Service desk" }).click();
		await expect(page).toHaveURL(/#\/servicedesk/);
		await expect(page.getByTestId("servicedesk-screen")).toBeVisible();

		// New ticket → Urgent priority (drives the SLA timer).
		await page.getByTestId("new-ticket").click();
		await expect(page.getByTestId("ticket-sheet")).toBeVisible();
		await page.getByTestId("t-subject").fill(SUBJECT);
		await page.getByTestId("t-priority").click();
		await page.getByRole("option", { name: "Urgent" }).click();
		await page.getByTestId("ticket-save").click();

		// Ticket shows on the board with priority + a live SLA countdown.
		const row = page.locator('[data-testid^="ticket-"]').filter({ hasText: SUBJECT });
		await expect(row).toBeVisible();
		await expect(row.getByText("Urgent")).toBeVisible();
		await expect(row.getByText(/left|Overdue/)).toBeVisible();

		// Assign to me → assignee shows the current user.
		await row.getByRole("button", { name: "Assign to me" }).click();
		await expect(row.getByText("gm@thereezort.com")).toBeVisible();
	});
});
