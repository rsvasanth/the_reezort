/**
 * Direct Billing API client for the_reezort.billing.direct_bill.* methods.
 * Uses the {ok, data, ...} envelope pattern (same as folio-api.ts).
 */

import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type DirectBillStatus = "Draft" | "Submitted" | "Posted" | "Paid" | "Outstanding" | "Cancelled" | "Failed";

export type DirectBillLine = {
	item_code: string;
	description?: string;
	qty: number;
	rate: number;
	tax_treatment?: string;
	discount_amount?: number;
	cost_center?: string;
};

export type DirectBillPayment = {
	mode_of_payment: string;
	amount?: number;
	reference_no?: string;
};

export type DirectBillSummary = {
	name: string;
	resort_property: string;
	customer: string;
	customer_name: string;
	source_department: string | null;
	direct_bill_status: DirectBillStatus;
	currency: string;
	total_amount: number;
	payment_mode: string | null;
	credit_allowed: boolean;
	sales_invoice: string | null;
	payment_entry: string | null;
	creation: string | null;
};

export type DirectBillItem = {
	item_code: string;
	item_name: string;
	description: string | null;
	qty: number;
	rate: number;
	amount: number;
};

export type DirectBillDetail = DirectBillSummary & {
	company: string;
	items: DirectBillItem[];
};

export type CreateDirectBillResult = {
	direct_bill: string;
	sales_invoice: string | null;
	payment_entry: string | null;
	posting_log: string | null;
	posting_status: string;
	reused: boolean;
};

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

async function envelopeCall<T>(
	path: string,
	method: "GET" | "POST",
	body?: Record<string, unknown>,
): Promise<T> {
	let url = `${BASE}/${path}`;
	if (method === "GET" && body) {
		const search = new URLSearchParams();
		for (const [k, v] of Object.entries(body)) {
			if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
		}
		const qs = search.toString();
		if (qs) url += `?${qs}`;
	}
	const response = await fetch(url, {
		method,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			...(method === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
	});
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		const msg =
			(parsed as { exception?: string } | undefined)?.exception ?? `${path} failed with ${response.status}`;
		throw new FolioApiError(msg, { status: response.status });
	}
	const envelope = (parsed as { message?: { ok?: boolean; data?: T } } | undefined)?.message;
	if (!envelope || !envelope.data) throw new FolioApiError(`${path} returned an unexpected body`, { status: response.status });
	return envelope.data;
}

export async function createDirectBill(input: {
	resort_property: string;
	customer: string;
	source_department?: string;
	idempotency_key: string;
	lines: DirectBillLine[];
	payment?: DirectBillPayment;
	credit_allowed?: boolean;
}): Promise<CreateDirectBillResult> {
	return envelopeCall("the_reezort.billing.direct_bill.create_direct_bill", "POST", {
		payload: input,
	});
}

export async function listDirectBills(
	resortProperty?: string,
	status?: DirectBillStatus,
	customer?: string,
): Promise<{ bills: DirectBillSummary[] }> {
	return envelopeCall("the_reezort.billing.direct_bill.list_direct_bills", "GET", {
		resort_property: resortProperty,
		status,
		customer,
	});
}

export async function getDirectBillDetail(directBill: string): Promise<DirectBillDetail> {
	return envelopeCall("the_reezort.billing.direct_bill.get_direct_bill_detail", "GET", {
		direct_bill: directBill,
	});
}
