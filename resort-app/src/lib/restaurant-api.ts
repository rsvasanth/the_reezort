/**
 * Restaurant POS API client — the_reezort.fnb.restaurant.* (spec 006 slice 3/4).
 *
 * Same live-with-mock-fallback contract as folio-api / fnb-api:
 *  - standard envelope { ok, data, warnings, blockers, next_actions }
 *  - throws FolioApiError on non-2xx / bad body
 *  - screens fall back to MOCK_* fixtures on network/5xx so the UI renders
 *    against realistic data before the backend deploys.
 *
 * The string-literal unions below MIRROR the backing doctype Select options
 * and are guarded by `yarn check:contracts` — do not hand-edit a value that
 * the doctype doesn't emit.
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import type { FnbOutlet } from "@/lib/fnb-api";

/**
 * The dine-in outlet a table/KOT screen should open on. In-Room Dining is a
 * virtual outlet (no tables — orders route through the folio IRD sheet), so
 * the POS floor plan must not default to it even though it's `is_default`.
 * Prefer the first non-IRD outlet; fall back to the first outlet.
 */
export function pickDineInOutlet(outlets: FnbOutlet[]): FnbOutlet | undefined {
	return outlets.find((o) => o.outlet_type !== "IRD") ?? outlets[0];
}

// ---------- doctype-mirrored unions (parity-guarded) ----------

export type RestaurantOrderState =
	| "Draft"
	| "Sent to Kitchen"
	| "Preparing"
	| "Ready"
	| "Served"
	| "Bill Pending"
	| "Settled"
	| "Cancelled";

export type RestaurantOrderItemLineStatus =
	| "Draft"
	| "Sent"
	| "Preparing"
	| "Ready"
	| "Served"
	| "86'd";

export type RestaurantTableZone =
	| "Indoor"
	| "Outdoor"
	| "Bar"
	| "Private"
	| "Poolside"
	| "Rooftop"
	| "Patio";

// The doctype allows an empty option for "unset"; the empty string is
// represented on the field type (KitchenSection | "" | null), not as a member
// here — the parity guard compares against the doctype's non-empty options.
export type KitchenSection =
	| "Hot Kitchen"
	| "Cold Kitchen"
	| "Bar"
	| "Pastry"
	| "Mixed";

// ---------- derived (not a doctype Select — computed server-side) ----------

export type TableLiveStatus = "Vacant" | "Seated" | "Preparing" | "Serving" | "Bill Pending";

// ---------- shapes ----------

export type RestaurantOrderItem = {
	name: string;
	menu_item: string;
	item_name: string;
	quantity: number;
	rate: number;
	amount: number;
	line_status: RestaurantOrderItemLineStatus;
	chef_note: string | null;
	sent_at: string | null;
	ready_at: string | null;
	served_at: string | null;
	// Imagery packet (backend _order_item_dict) — lets every surface render the
	// shared MenuItemThumb without a second round-trip to list_menu_items.
	image: string | null;
	veg_flag: string | null;
	spice_level: number | null;
	category: string | null;
};

export type RestaurantOrder = {
	name: string;
	outlet: string;
	table: string | null;
	state: RestaurantOrderState;
	kot_number: string | null;
	kitchen_section: KitchenSection | "" | null;
	party_size: number;
	guest_name: string | null;
	waiter_user: string;
	opened_at: string;
	sent_to_kitchen_at: string | null;
	ready_at: string | null;
	served_at: string | null;
	settled_at: string | null;
	subtotal: number;
	discount_amount: number;
	service_charge_pct: number;
	service_charge_amount: number;
	total_taxes: number;
	grand_total: number;
	currency: string;
	chef_notes: string | null;
	guest_note: string | null;
	erpnext_sales_invoice: string | null;
	erpnext_payment_entry: string | null;
	items: RestaurantOrderItem[];
};

export type TableOpenOrder = {
	name: string;
	state: RestaurantOrderState;
	opened_at: string;
	grand_total: number;
	guest_name: string | null;
	kot_number: string | null;
};

export type RestaurantTable = {
	name: string;
	table_code: string;
	table_name: string;
	zone: RestaurantTableZone;
	seats: number;
	display_order: number;
	live_status: TableLiveStatus;
	open_order: TableOpenOrder | null;
};

export type AddItemInput = {
	menu_item: string;
	quantity: number;
	rate?: number;
	chef_note?: string;
};

export type SettlePaymentInput = {
	mode_of_payment: string;
	amount: number;
};

// ---------- low-level ----------

const BASE = "/api/method";
const NS = "the_reezort.fnb.restaurant";

function readCsrfToken(): string {
	const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf_token"]');
	if (meta?.content) return meta.content;
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	return w.csrf_token ?? w.frappe?.csrf_token ?? "";
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function unwrap<T>(parsed: unknown): T | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	return (parsed as { message?: T }).message;
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	const env = unwrap<FolioApiEnvelope<unknown>>(parsed);
	const list = env && (env as Record<string, unknown>)[key];
	return Array.isArray(list) ? (list as FolioMessage[]) : [];
}

async function call<T>(
	method: string,
	init:
		| { method: "GET"; params?: Record<string, string | number | undefined> }
		| { method: "POST"; body: Record<string, unknown> },
): Promise<T> {
	let url = `${BASE}/${NS}.${method}`;
	if (init.method === "GET" && init.params) {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(init.params)) {
			if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
		}
		const qs = q.toString();
		if (qs) url += `?${qs}`;
	}
	const res = await fetch(url, {
		method: init.method,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
	});
	const text = await res.text();
	const parsed = text ? safeJson(text) : undefined;
	if (!res.ok) {
		throw new FolioApiError(`${method} failed with ${res.status}`, {
			status: res.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}
	const env = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!env || typeof env !== "object" || env.data === undefined) {
		throw new FolioApiError(`${method} returned an unexpected body`, { status: res.status });
	}
	return env.data;
}

// ---------- endpoints ----------

export function listTables(outlet: string) {
	return call<{ outlet: string; tables: RestaurantTable[] }>("list_tables", {
		method: "GET",
		params: { outlet },
	});
}

export function openWalkInOrder(input: {
	outlet: string;
	table?: string;
	party_size?: number;
	guest_name?: string;
	opened_at?: string;
}) {
	return call<{ order: RestaurantOrder; reused: boolean }>("open_walk_in_order", {
		method: "POST",
		body: { ...input },
	});
}

export function addItems(order: string, items: AddItemInput[]) {
	return call<{ order: RestaurantOrder }>("add_items", { method: "POST", body: { order, items } });
}

export function sendToKitchen(order: string) {
	return call<{ order: RestaurantOrder }>("send_to_kitchen", { method: "POST", body: { order } });
}

export function listActiveKots(outlet: string) {
	return call<{ outlet: string; orders: RestaurantOrder[] }>("list_active_kots", {
		method: "GET",
		params: { outlet },
	});
}

export function markKotStatus(order: string, status: "Preparing" | "Ready" | "Served") {
	return call<{ order: RestaurantOrder }>("mark_kot_status", {
		method: "POST",
		body: { order, status },
	});
}

export function closeWalkIn(order: string, payments?: SettlePaymentInput[]) {
	return call<{ order: RestaurantOrder; sales_invoice: string; payment_entry: string }>(
		"close_walk_in",
		{ method: "POST", body: { order, payments } },
	);
}

export function cancelOrder(order: string, reason?: string) {
	return call<{ order: RestaurantOrder }>("cancel_order", { method: "POST", body: { order, reason } });
}

export function getOrder(order: string) {
	return call<{ order: RestaurantOrder }>("get_order", { method: "GET", params: { order } });
}

// ---------- dev mock fixtures (network/5xx fallback before deploy) ----------

export const MOCK_TABLES: RestaurantTable[] = [
	{ name: "SIGREST-T01", table_code: "T01", table_name: "Window 1", zone: "Indoor", seats: 4, display_order: 1, live_status: "Preparing", open_order: { name: "RZ-POS-2026-00001", state: "Preparing", opened_at: "2026-07-02 14:22:00", grand_total: 2450, guest_name: null, kot_number: "KOT-001" } },
	{ name: "SIGREST-T02", table_code: "T02", table_name: "Window 2", zone: "Indoor", seats: 4, display_order: 2, live_status: "Vacant", open_order: null },
	{ name: "SIGREST-T03", table_code: "T03", table_name: "Center 1", zone: "Indoor", seats: 2, display_order: 3, live_status: "Serving", open_order: { name: "RZ-POS-2026-00002", state: "Served", opened_at: "2026-07-02 13:50:00", grand_total: 3820, guest_name: "Kapoor", kot_number: "KOT-002" } },
	{ name: "SIGREST-T04", table_code: "T04", table_name: "Center 2", zone: "Indoor", seats: 6, display_order: 4, live_status: "Bill Pending", open_order: { name: "RZ-POS-2026-00003", state: "Bill Pending", opened_at: "2026-07-02 13:10:00", grand_total: 6540, guest_name: "Sharma", kot_number: "KOT-003" } },
	{ name: "SIGREST-P01", table_code: "P01", table_name: "Poolside 1", zone: "Poolside", seats: 4, display_order: 5, live_status: "Seated", open_order: { name: "RZ-POS-2026-00004", state: "Draft", opened_at: "2026-07-02 14:35:00", grand_total: 0, guest_name: null, kot_number: null } },
	{ name: "SIGREST-P02", table_code: "P02", table_name: "Poolside 2", zone: "Poolside", seats: 4, display_order: 6, live_status: "Vacant", open_order: null },
	{ name: "SIGREST-R01", table_code: "R01", table_name: "Rooftop 1", zone: "Rooftop", seats: 2, display_order: 7, live_status: "Vacant", open_order: null },
	{ name: "SIGREST-B01", table_code: "B01", table_name: "Bar 1", zone: "Bar", seats: 2, display_order: 8, live_status: "Preparing", open_order: { name: "RZ-POS-2026-00005", state: "Sent to Kitchen", opened_at: "2026-07-02 14:40:00", grand_total: 1180, guest_name: null, kot_number: "KOT-004" } },
];

function mockItem(over: Partial<RestaurantOrderItem> & { item_name: string }): RestaurantOrderItem {
	return {
		name: `it-${Math.round(over.rate ?? 0)}-${over.item_name.length}`,
		menu_item: over.item_name,
		quantity: 1,
		rate: 0,
		amount: 0,
		line_status: "Sent",
		chef_note: null,
		sent_at: "2026-07-02 14:22:00",
		ready_at: null,
		served_at: null,
		image: null,
		veg_flag: "Non-veg",
		spice_level: null,
		category: "Mains",
		...over,
	};
}

export const MOCK_KOTS: RestaurantOrder[] = [
	{
		name: "RZ-POS-2026-00001", outlet: "Signature Restaurant", table: "SIGREST-T01", state: "Preparing",
		kot_number: "KOT-001", kitchen_section: "Hot Kitchen", party_size: 4, guest_name: null, waiter_user: "ravi@thereezort.com",
		opened_at: "2026-07-02 14:22:00", sent_to_kitchen_at: "2026-07-02 14:25:00", ready_at: null, served_at: null, settled_at: null,
		subtotal: 2200, discount_amount: 0, service_charge_pct: 0, service_charge_amount: 0, total_taxes: 250, grand_total: 2450, currency: "INR",
		chef_notes: "No nuts on table — allergy", guest_note: null, erpnext_sales_invoice: null, erpnext_payment_entry: null,
		items: [
			mockItem({ item_name: "Butter Chicken", quantity: 2, rate: 850, amount: 1700, line_status: "Preparing", chef_note: "No nuts" }),
			mockItem({ item_name: "Garlic Naan", quantity: 4, rate: 125, amount: 500, line_status: "Ready" }),
		],
	},
	{
		name: "RZ-POS-2026-00005", outlet: "Signature Restaurant", table: "SIGREST-B01", state: "Sent to Kitchen",
		kot_number: "KOT-004", kitchen_section: "Bar", party_size: 2, guest_name: null, waiter_user: "meera@thereezort.com",
		opened_at: "2026-07-02 14:40:00", sent_to_kitchen_at: "2026-07-02 14:41:00", ready_at: null, served_at: null, settled_at: null,
		subtotal: 1050, discount_amount: 0, service_charge_pct: 0, service_charge_amount: 0, total_taxes: 130, grand_total: 1180, currency: "INR",
		chef_notes: null, guest_note: null, erpnext_sales_invoice: null, erpnext_payment_entry: null,
		items: [
			mockItem({ item_name: "Old Fashioned", quantity: 2, rate: 525, amount: 1050, line_status: "Sent" }),
		],
	},
];
