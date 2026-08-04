/**
 * Event Space / Activity Area / Spa Room client (spec 001 §Spaces).
 * Backend: the_reezort.property.event_spaces.*
 *
 * Covers list / create / activate-deactivate for the three space entities so
 * staff can manage them from the SPA (schema consumed later by 007/011).
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type OperatingStatus = "Available" | "Under Maintenance" | "Out of Service";

export type EventSpace = {
	name: string;
	resort_property: string;
	space_name: string;
	space_code: string;
	building?: string | null;
	floor?: string | null;
	capacity?: number | null;
	area_sqft?: number | null;
	divisible?: number;
	operating_status: OperatingStatus;
	is_active: number;
};

export type ActivityAreaType = "Spa Room" | "Wellness" | "Activity" | "Pool" | "Cabana" | "Facility" | "Other";

export type ActivityArea = {
	name: string;
	resort_property: string;
	area_name: string;
	area_code: string;
	area_type: ActivityAreaType;
	linked_service_location?: string | null;
	capacity?: number | null;
	operating_status: OperatingStatus;
	is_active: number;
};

export type SpaRoom = {
	name: string;
	resort_property: string;
	spa_room_name: string;
	spa_room_code: string;
	outlet?: string | null;
	capacity?: number | null;
	default_duration_buffer?: number | null;
	operating_status: OperatingStatus;
	is_active: number;
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

async function call<T>(
	path: string,
	init: { method: "GET"; params: Record<string, string | undefined> } | { method: "POST"; body: Record<string, unknown> }
): Promise<T> {
	let url = `${BASE}/${path}`;
	if (init.method === "GET") {
		const search = new URLSearchParams();
		for (const [k, v] of Object.entries(init.params)) {
			if (v !== undefined && v !== "") search.set(k, v);
		}
		url = `${url}?${search}`;
	}
	const response = await fetch(url, {
		method: init.method,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
	});
	const text = await response.text();
	const parsed = text ? safeJson(text) : undefined;
	if (!response.ok) {
		throw new FolioApiError(`Spaces ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}
	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Spaces ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

const P = "the_reezort.property.event_spaces";

// ---------- Event Space ----------
export async function listEventSpaces(resortProperty: string): Promise<{ event_spaces: EventSpace[]; total: number }> {
	return call(`${P}.list_event_spaces`, { method: "GET", params: { resort_property: resortProperty, include_inactive: "1" } });
}
export async function createEventSpace(payload: Partial<EventSpace>): Promise<{ event_space: EventSpace }> {
	return call(`${P}.create_event_space`, { method: "POST", body: { payload } });
}
export async function setEventSpaceActive(name: string, isActive: boolean): Promise<{ name: string; is_active: number }> {
	return call(`${P}.set_event_space_active`, { method: "POST", body: { name, is_active: isActive ? 1 : 0 } });
}

// ---------- Activity Area ----------
export async function listActivityAreas(resortProperty: string): Promise<{ activity_areas: ActivityArea[]; total: number }> {
	return call(`${P}.list_activity_areas`, { method: "GET", params: { resort_property: resortProperty, include_inactive: "1" } });
}
export async function createActivityArea(payload: Partial<ActivityArea>): Promise<{ activity_area: ActivityArea }> {
	return call(`${P}.create_activity_area`, { method: "POST", body: { payload } });
}
export async function setActivityAreaActive(name: string, isActive: boolean): Promise<{ name: string; is_active: number }> {
	return call(`${P}.set_activity_area_active`, { method: "POST", body: { name, is_active: isActive ? 1 : 0 } });
}

// ---------- Spa Room ----------
export async function listSpaRooms(resortProperty: string): Promise<{ spa_rooms: SpaRoom[]; total: number }> {
	return call(`${P}.list_spa_rooms`, { method: "GET", params: { resort_property: resortProperty, include_inactive: "1" } });
}
export async function createSpaRoom(payload: Partial<SpaRoom>): Promise<{ spa_room: SpaRoom }> {
	return call(`${P}.create_spa_room`, { method: "POST", body: { payload } });
}
export async function setSpaRoomActive(name: string, isActive: boolean): Promise<{ name: string; is_active: number }> {
	return call(`${P}.set_spa_room_active`, { method: "POST", body: { name, is_active: isActive ? 1 : 0 } });
}
