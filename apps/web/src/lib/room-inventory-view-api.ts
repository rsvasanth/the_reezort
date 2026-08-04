/**
 * Room Type Inventory View client (spec 001 §Room Type Inventory View).
 * Backend: the_reezort.property.api.get_room_type_inventory_view
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type RoomTypeInventoryRow = {
	room_type: string;
	room_type_code: string;
	room_type_name: string;
	total_rooms: number;
	active_rooms: number;
	sellable_rooms: number;
	out_of_order: number;
	out_of_service: number;
	dirty: number;
	available_for_range?: number;
};

export type RoomTypeInventoryResult = {
	inventory: RoomTypeInventoryRow[];
	date_range?: { start_date: string; end_date: string };
};

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

function safeJson(text: string): unknown {
	try { return JSON.parse(text); } catch { return undefined; }
}

function unwrap<T>(parsed: unknown): T | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const obj = parsed as Record<string, unknown>;
	return ("message" in obj ? (obj.message as T) : (parsed as T));
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	const env = unwrap<FolioApiEnvelope<unknown>>(parsed);
	const list = env && (env as Record<string, unknown>)[key];
	return Array.isArray(list) ? (list as FolioMessage[]) : [];
}

export async function getRoomTypeInventoryView(
	property: string,
	startDate?: string,
	endDate?: string
): Promise<RoomTypeInventoryResult> {
	const search = new URLSearchParams({ property });
	if (startDate) search.set("start_date", startDate);
	if (endDate) search.set("end_date", endDate);
	const url = `${BASE}/the_reezort.property.api.get_room_type_inventory_view?${search}`;

	const response = await fetch(url, {
		method: "GET",
		credentials: "include",
		headers: { Accept: "application/json", "X-Frappe-CSRF-Token": readCsrfToken() },
	});
	const text = await response.text();
	const parsed = text ? safeJson(text) : undefined;

	if (!response.ok) {
		throw new FolioApiError(`Inventory view failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}
	const envelope = unwrap<FolioApiEnvelope<RoomTypeInventoryResult>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError("Inventory view returned an unexpected body", { status: response.status });
	}
	return envelope.data;
}
