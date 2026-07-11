/**
 * Room Status Event API client.
 * Backs the Status History tab in RoomWorkspace.
 *
 * Backend: the_reezort.the_reezort.doctype.room_status_event.room_status_event.list_room_status_events
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

// ---------- Domain types ----------

export type RoomStatusEvent = {
	name: string;
	event_type: "Occupancy" | "Housekeeping" | "Maintenance" | "Sellable";
	previous_value: string;
	new_value: string;
	reason: string;
	changed_by: string;
	changed_at: string;
};

export type ListStatusEventsResult = {
	room: string;
	total: number;
	page: number;
	page_size: number;
	events: RoomStatusEvent[];
};

// ---------- Transport ----------

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

async function callEvents<T>(
	path: string,
	params: Record<string, string | undefined>
): Promise<T> {
	const search = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== "") search.set(k, v);
	}
	const url = `${BASE}/${path}?${search}`;

	const response = await fetch(url, {
		method: "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
		},
	});

	const text = await response.text();
	const parsed = text ? safeJson(text) : undefined;

	if (!response.ok) {
		throw new FolioApiError(`StatusEvents ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`StatusEvents ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

// ---------- Endpoints ----------

export async function listRoomStatusEvents(
	room: string,
	page = 1,
	pageSize = 20
): Promise<ListStatusEventsResult> {
	return callEvents<ListStatusEventsResult>(
		"the_reezort.the_reezort.doctype.room_status_event.room_status_event.list_room_status_events",
		{ room, page: String(page), page_size: String(pageSize) }
	);
}
