/**
 * F&B In-Room Dining — client wrapper (spec 006 · Slice 1).
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";

const BASE = "/api/method";

function readCsrfToken(): string {
	const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf_token"]');
	if (meta?.content) return meta.content;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as any;
	return w?.csrf_token || w?.frappe?.csrf_token || "";
}
function safeJson(text: string): unknown { try { return JSON.parse(text); } catch { return undefined; } }
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
	path: string,
	init: { method: "GET"; params?: Record<string, string | number | undefined> } | { method: "POST"; body: Record<string, unknown> },
): Promise<T> {
	let url = `${BASE}/${path}`;
	if (init.method === "GET" && init.params) {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(init.params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
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
		throw new FolioApiError(`${path} failed with ${res.status}`, {
			status: res.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}
	const env = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!env || typeof env !== "object" || env.data === undefined) {
		throw new FolioApiError(`${path} returned an unexpected body`, { status: res.status });
	}
	return env.data;
}

// ---------- shape ----------

export type FnbOutlet = {
	name: string;
	outlet_name: string;
	outlet_code: string;
	outlet_type: string;
	is_default: 0 | 1;
	default_service_charge_pct: number | null;
};

export type MenuItem = {
	name: string;
	item_name: string;
	item_code_short: string;
	description: string | null;
	category: string;
	price: number;
	currency: string | null;
	erpnext_item: string | null;
	veg_flag: "Veg" | "Non-veg" | "Egg" | "Vegan" | string;
	spice_level: number | null;
	prep_time_minutes: number | null;
	allergens: string | null;
	tags: string | null;
	image: string | null;
};

export type FnbOrderRow = {
	name: string;
	outlet: string;
	outlet_name: string;
	ordered_at: string;
	ordered_by: string;
	total_amount: number;
	currency: string;
	state: "Posted" | "Voided" | string;
	folio_line: string | null;
	chef_notes: string | null;
	guest_note: string | null;
	items: Array<{
		menu_item: string;
		item_name: string;
		quantity: number;
		rate: number;
		amount: number;
	}>;
};

export async function listOutlets(resortProperty?: string): Promise<{ outlets: FnbOutlet[] }> {
	return call("the_reezort.fnb.api.list_outlets", {
		method: "GET",
		params: resortProperty ? { resort_property: resortProperty } : {},
	});
}

export async function listMenuItems(outlet: string): Promise<{ outlet: string; items: MenuItem[] }> {
	return call("the_reezort.fnb.api.list_menu_items", {
		method: "GET",
		params: { outlet },
	});
}

export async function postRoomChargeOrder(payload: {
	stay: string;
	outlet: string;
	items: Array<{ menu_item: string; quantity: number }>;
	ordered_at?: string;
	chef_notes?: string;
	guest_note?: string;
	approval_request?: string;
}): Promise<{ folio_line: string; fnb_order: string; total_amount: number; reused: boolean }> {
	return call("the_reezort.fnb.api.post_room_charge_order", { method: "POST", body: payload });
}

/**
 * In-room-dining order that ALSO fires a real KOT to the kitchen (bridges the
 * front-desk / room-service order onto the same kitchen queue as POS tables).
 * The folio is charged automatically when the kitchen marks it Served.
 */
export async function createRoomServiceOrder(payload: {
	stay: string;
	outlet: string;
	items: Array<{ menu_item: string; quantity: number }>;
	party_size?: number;
	guest_name?: string;
	chef_notes?: string;
	guest_note?: string;
}): Promise<{ order: { name: string; kot_number: string | null; state: string; grand_total: number } }> {
	return call("the_reezort.fnb.restaurant.create_room_service_order", { method: "POST", body: payload });
}

export async function listRecentFnbOrders(stay: string, limit = 10): Promise<{ orders: FnbOrderRow[] }> {
	return call("the_reezort.fnb.api.list_recent_orders", {
		method: "GET",
		params: { stay, limit },
	});
}
