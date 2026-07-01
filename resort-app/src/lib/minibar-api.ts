/**
 * Minibar posting — client wrapper (spec 004 / ui-ux-minibar-posting).
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

export type MinibarCategory = "Beverages" | "Snacks" | "Alcohol" | "Other";

export type MinibarItem = {
	name: string;
	item_name: string;
	item_code_short: string;
	category: MinibarCategory | string;
	price: number;
	currency: string | null;
	erpnext_item: string | null;
	par_level_per_room: number | null;
};

export type MinibarPostingRow = {
	name: string;
	consumed_at: string;
	posted_by: string;
	total_amount: number;
	currency: string;
	state: "Posted" | "Voided" | string;
	folio_line: string | null;
	notes: string | null;
	items: Array<{
		minibar_item: string;
		item_name: string;
		quantity: number;
		rate: number;
		amount: number;
	}>;
};

export async function listMinibarItems(resortProperty?: string): Promise<{ items: MinibarItem[] }> {
	return call("the_reezort.minibar.api.list_minibar_items", {
		method: "GET",
		params: resortProperty ? { resort_property: resortProperty } : {},
	});
}

export async function postMinibarConsumption(payload: {
	stay: string;
	items: Array<{ minibar_item: string; quantity: number }>;
	consumed_at?: string;
	notes?: string;
	approval_request?: string;
}): Promise<{ folio_line: string; minibar_posting: string; total_amount: number; reused: boolean }> {
	return call("the_reezort.minibar.api.post_minibar_consumption", { method: "POST", body: payload });
}

export async function listRecentMinibarPostings(stay: string, limit = 10): Promise<{ postings: MinibarPostingRow[] }> {
	return call("the_reezort.minibar.api.list_recent_postings", {
		method: "GET",
		params: { stay, limit },
	});
}
