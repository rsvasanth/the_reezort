/**
 * Billing overview client for the_reezort.billing.overview.* methods.
 * Read-only ledger of Sales Invoices + Payment Entries.
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type BillingInvoice = {
	name: string;
	customer: string;
	posting_date: string | null;
	grand_total: number;
	outstanding_amount: number;
	status: string;
	currency: string;
};

export type BillingPayment = {
	name: string;
	party: string;
	posting_date: string | null;
	paid_amount: number;
	mode_of_payment: string | null;
	reference_no: string | null;
};

export type BillingOverview = {
	company: string;
	currency: string;
	summary: { invoiced: number; collected: number; outstanding: number; invoice_count: number };
	invoices: BillingInvoice[];
	payments: BillingPayment[];
};

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	if (!parsed || typeof parsed !== "object") return [];
	const env = ("message" in (parsed as Record<string, unknown>)
		? (parsed as Record<string, unknown>).message
		: parsed) as Record<string, unknown> | undefined;
	const list = env && env[key];
	return Array.isArray(list) ? (list as FolioMessage[]) : [];
}

export async function getBillingOverview(): Promise<BillingOverview> {
	const response = await fetch(`${BASE}/the_reezort.billing.overview.get_billing_overview`, {
		credentials: "include",
		headers: { Accept: "application/json", "X-Frappe-CSRF-Token": readCsrfToken() },
	});
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		throw new FolioApiError(`Billing overview failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
		});
	}
	const data = (parsed as { message?: { data?: BillingOverview } } | undefined)?.message?.data;
	if (!data) throw new FolioApiError("Billing overview returned an unexpected body", { status: response.status });
	return data;
}
