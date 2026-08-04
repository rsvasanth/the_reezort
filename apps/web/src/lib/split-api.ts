/**
 * Split-bill API client for the_reezort.fnb.split.* — spec 006 Workflow 5.
 * Uses the {ok, data} envelope pattern.
 */

import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type SplitType = "Item" | "Seat" | "Amount" | "Percentage" | "Custom";
export type SettlementMode = "Direct" | "Room";
export type SplitStatus = "Draft" | "Settled" | "Cancelled";

export type SplitItem = {
	order_item_row: string;
	menu_item: string;
	item_name: string;
	qty: number;
	rate: number;
	amount: number;
};

export type BillSplit = {
	name: string;
	restaurant_order: string;
	split_type: SplitType;
	split_label: string | null;
	settlement_mode: SettlementMode;
	room_stay: string | null;
	customer_name: string | null;
	portion_pct: number;
	split_status: SplitStatus;
	net_amount: number;
	service_charge_amount: number;
	tax_amount: number;
	grand_total: number;
	currency: string | null;
	erpnext_sales_invoice: string | null;
	erpnext_payment_entry: string | null;
	guest_folio: string | null;
	settled_at: string | null;
	items: SplitItem[];
};

/** One portion the cashier defines when creating a plan. */
export type PortionInput = {
	label: string;
	settlement_mode: SettlementMode;
	stay?: string;
	customer_name?: string;
	items?: { order_item: string; qty: number }[];
	amount?: number;
	percentage?: number;
};

export type SplitPayment = {
	mode_of_payment: string;
	amount?: number;
	reference_no?: string;
};

const BASE = "/api/method";
const NS = "the_reezort.fnb.split";

function readCsrfToken(): string {
	const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf_token"]');
	if (meta?.content) return meta.content;
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

async function envelopeCall<T>(
	method: string,
	verb: "GET" | "POST",
	body?: Record<string, unknown>,
): Promise<T> {
	let url = `${BASE}/${NS}.${method}`;
	if (verb === "GET" && body) {
		const search = new URLSearchParams();
		for (const [k, v] of Object.entries(body)) {
			if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
		}
		const qs = search.toString();
		if (qs) url += `?${qs}`;
	}
	const response = await fetch(url, {
		method: verb,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			...(verb === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: verb === "POST" ? JSON.stringify(body ?? {}) : undefined,
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
			(parsed as { exception?: string } | undefined)?.exception ?? `${method} failed with ${response.status}`;
		throw new FolioApiError(msg, { status: response.status });
	}
	const envelope = (parsed as { message?: { ok?: boolean; data?: T } } | undefined)?.message;
	if (!envelope || envelope.data === undefined)
		throw new FolioApiError(`${method} returned an unexpected body`, { status: response.status });
	return envelope.data;
}

export async function createSplitPlan(
	order: string,
	splitType: SplitType,
	splits: PortionInput[],
): Promise<{ order: string; splits: BillSplit[] }> {
	return envelopeCall("create_split_plan", "POST", { order, split_type: splitType, splits });
}

export async function listSplits(order: string): Promise<{ order: string; splits: BillSplit[] }> {
	return envelopeCall("list_splits", "GET", { order });
}

export async function settleSplit(
	split: string,
	payments?: SplitPayment[],
	stay?: string,
): Promise<{ split: BillSplit; order_settled: boolean; splits: BillSplit[]; reused?: boolean }> {
	return envelopeCall("settle_split", "POST", { split, payments, stay });
}

export async function cancelSplitPlan(order: string): Promise<{ order: string; splits: BillSplit[] }> {
	return envelopeCall("cancel_split_plan", "POST", { order });
}
