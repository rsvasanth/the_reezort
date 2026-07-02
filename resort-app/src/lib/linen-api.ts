/**
 * Linen count / laundry hand-off — client wrapper (spec 005).
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

export type LinenParRow = {
	name: string;
	item_name: string;
	item_code_short: string;
	category: string;
	unit_cost: number | null;
	par: number;
};

export type LinenLastCount = {
	name: string;
	counted_at: string;
	phase: string;
	short_count: number;
	damaged_count: number;
	missing_count: number;
};

export type RoomPar = {
	room: string;
	items: LinenParRow[];
	last_count: LinenLastCount | null;
};

export type LinenCountInput = {
	linen_item: string;
	par: number;
	found: number;
	damaged?: number;
	missing?: number;
	notes?: string;
};

export type LinenMovementRow = {
	name: string;
	counted_at: string;
	phase: string;
	counted_by: string | null;
	short_count: number;
	damaged_count: number;
	missing_count: number;
	damage_value: number;
	restock_task: string | null;
};

export async function getRoomPar(room: string): Promise<RoomPar> {
	return call("the_reezort.housekeeping.linen.get_room_par", {
		method: "GET",
		params: { room },
	});
}

export async function postLinenCount(payload: {
	room: string;
	counts: LinenCountInput[];
	phase?: "Departure" | "Mid-stay" | "Par audit";
	stay?: string | null;
	notes?: string;
	counted_at?: string;
	approval_request?: string;
}): Promise<{
	linen_movement: string;
	restock_task: string | null;
	short_count: number;
	damaged_count: number;
	missing_count: number;
	damage_value: number;
	reused: boolean;
}> {
	return call("the_reezort.housekeeping.linen.post_linen_count", {
		method: "POST",
		body: payload,
	});
}

export async function listRecentLinenCounts(room: string, days = 30, limit = 5): Promise<{ movements: LinenMovementRow[] }> {
	return call("the_reezort.housekeeping.linen.list_recent_counts", {
		method: "GET",
		params: { room, days, limit },
	});
}
