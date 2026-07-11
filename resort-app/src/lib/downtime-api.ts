/**
 * Room Downtime + Engineering Board API client (spec 009).
 *
 * Endpoints: the_reezort.maintenance.downtime.*
 * Same envelope-unwrapping + CSRF pattern as maintenance-api.ts.
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope } from "@/lib/folio-api";

// ---------- doctype-mirrored unions (parity-guarded) ----------

export type DowntimeType =
	| "Under Repair"
	| "Out of Service"
	| "Out of Order"
	| "Planned Maintenance"
	| "Management Hold";

export type DowntimeStatus =
	| "Draft"
	| "Active"
	| "Extended"
	| "Pending Release"
	| "Released"
	| "Cancelled";

export type RevenueImpactClass = "None" | "Low" | "Medium" | "High" | "Critical";

export type VerificationStatus =
	| "Pending"
	| "Passed"
	| "Failed"
	| "Housekeeping Required"
	| "Cancelled";

// ---------- shapes ----------

export type RoomDowntime = {
	name: string;
	resort_property: string;
	room: string;
	maintenance_ticket: string;
	downtime_type: DowntimeType;
	downtime_status: DowntimeStatus;
	revenue_impact_class: RevenueImpactClass;
	housekeeping_required: boolean;
	start_at: string;
	expected_release_at: string;
	actual_release_at: string | null;
	extension_count: number;
	reason: string;
	affected_reservation: string | null;
	affected_stay: string | null;
	approved_by: string | null;
	release_verified_by: string | null;
};

export type EngineeringBoardResult = {
	tickets: import("@/lib/maintenance-api").MaintenanceTicket[];
	counts: Record<string, number>;
	overdue: number;
};

export type DowntimeBoardResult = {
	downtimes: RoomDowntime[];
	counts: Record<DowntimeStatus, number>;
};

export type CreateDowntimePayload = {
	room: string;
	maintenance_ticket: string;
	downtime_type: DowntimeType;
	start_at: string;
	expected_release_at: string;
	reason: string;
	revenue_impact_class?: RevenueImpactClass;
	housekeeping_required?: boolean;
	approved_by?: string | null;
	affected_reservation?: string | null;
	affected_stay?: string | null;
};

export type VerificationPayload = {
	verification_status: VerificationStatus;
	verified_by: string;
	notes?: string;
};

// ---------- low-level ----------

const BASE = "/api/method";
const NS = "the_reezort.maintenance.downtime";

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

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): import("@/lib/folio-api").FolioMessage[] {
	const env = unwrap<FolioApiEnvelope<unknown>>(parsed);
	const list = env && (env as Record<string, unknown>)[key];
	return Array.isArray(list) ? (list as import("@/lib/folio-api").FolioMessage[]) : [];
}

async function callData<T>(
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
		throw new FolioApiError(`${method} returned unexpected body`, { status: res.status });
	}
	return env.data as T;
}

// ---------- endpoints ----------

export function getEngineeringBoard(
	property: string,
	filters?: { state?: string; priority?: string; room?: string; assigned_to?: string },
): Promise<EngineeringBoardResult> {
	return callData<EngineeringBoardResult>("get_engineering_board", {
		method: "GET",
		params: { property, ...filters },
	});
}

export function getRoomDowntimeBoard(
	property: string,
	filters?: { downtime_status?: string; downtime_type?: string; room?: string },
): Promise<DowntimeBoardResult> {
	return callData<DowntimeBoardResult>("get_room_downtime_board", {
		method: "GET",
		params: { property, ...filters },
	});
}

export function createRoomDowntime(payload: CreateDowntimePayload): Promise<{ downtime: RoomDowntime }> {
	return callData("create_room_downtime", { method: "POST", body: { payload } });
}

export function extendRoomDowntime(
	room_downtime: string,
	expected_release_at: string,
	reason: string,
	approval?: string | null,
): Promise<{ downtime: RoomDowntime }> {
	return callData("extend_room_downtime", {
		method: "POST",
		body: { room_downtime, expected_release_at, reason, approval },
	});
}

export function requestRoomRelease(
	room_downtime: string,
	notes?: string,
): Promise<{ downtime: RoomDowntime }> {
	return callData("request_room_release", {
		method: "POST",
		body: { room_downtime, notes },
	});
}

export function verifyAndReleaseRoom(
	room_downtime: string,
	verification: VerificationPayload,
): Promise<{ downtime: RoomDowntime; released: boolean; blockers: string[] }> {
	return callData("verify_and_release_room", {
		method: "POST",
		body: { room_downtime, verification },
	});
}

// ---------- mock data ----------

export const MOCK_DOWNTIMES: RoomDowntime[] = [
	{
		name: "RZ-RDT-2026-00001",
		resort_property: "REEZORT",
		room: "REEZORT-V4",
		maintenance_ticket: "RZ-MNT-2026-00001",
		downtime_type: "Under Repair",
		downtime_status: "Active",
		revenue_impact_class: "High",
		housekeeping_required: true,
		start_at: "2026-07-11 09:00:00",
		expected_release_at: "2026-07-11 18:00:00",
		actual_release_at: null,
		extension_count: 0,
		reason: "AC compressor failure — awaiting parts",
		affected_reservation: null,
		affected_stay: null,
		approved_by: null,
		release_verified_by: null,
	},
	{
		name: "RZ-RDT-2026-00002",
		resort_property: "REEZORT",
		room: "REEZORT-V7",
		maintenance_ticket: "RZ-MNT-2026-00003",
		downtime_type: "Out of Service",
		downtime_status: "Pending Release",
		revenue_impact_class: "Medium",
		housekeeping_required: false,
		start_at: "2026-07-10 14:00:00",
		expected_release_at: "2026-07-11 12:00:00",
		actual_release_at: null,
		extension_count: 1,
		reason: "Electrical fault in junction box",
		affected_reservation: null,
		affected_stay: null,
		approved_by: null,
		release_verified_by: null,
	},
];
