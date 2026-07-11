/**
 * Maintenance ticketing API client — the_reezort.maintenance.api.* (spec 009).
 *
 * Same live-with-mock-fallback contract as folio/fnb/restaurant clients:
 * standard envelope { ok, data, warnings, blockers, next_actions }, throws
 * FolioApiError on non-2xx/bad body, screens fall back to MOCK_* on a true
 * network failure.
 *
 * The string-literal unions mirror the Maintenance Ticket doctype Select
 * options and are guarded by `yarn check:contracts`.
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";

// ---------- doctype-mirrored unions (parity-guarded) ----------

export type MaintenanceState =
	| "Reported"
	| "Assigned"
	| "In Progress"
	| "Waiting for Parts"
	| "On Hold"
	| "Resolved"
	| "Verification Required"
	| "Released"
	| "Closed"
	| "Duplicate";

export type MaintenanceCategory =
	| "HVAC"
	| "Plumbing"
	| "Electrical"
	| "Structural"
	| "IT"
	| "Housekeeping Equipment"
	| "Landscape"
	| "Other";

export type MaintenancePriority =
	| "Low"
	| "Normal"
	| "High"
	| "Urgent"
	| "Guest Impacting"
	| "Safety Critical"
	| "Revenue Blocking";

export type MaintenanceSeverity = "Minor" | "Moderate" | "Major" | "Critical";

/** States that count as still-open (drive the overdue KPI + default filter). */
export const OPEN_STATES: MaintenanceState[] = [
	"Reported",
	"Assigned",
	"In Progress",
	"Waiting for Parts",
	"On Hold",
	"Verification Required",
];

// ---------- shapes ----------

export type MaintenancePhoto = {
	image: string;
	caption: string | null;
};

export type MaintenanceTicket = {
	name: string;
	resort_property: string;
	subject: string;
	description: string | null;
	state: MaintenanceState;
	category: MaintenanceCategory;
	priority: MaintenancePriority;
	severity: MaintenanceSeverity | null;
	room: string | null;
	stay: string | null;
	guest: string | null;
	raised_by: string;
	assigned_to: string | null;
	source_doctype: string | null;
	source_name: string | null;
	reported_at: string;
	sla_due: string;
	assigned_at: string | null;
	started_at: string | null;
	resolved_at: string | null;
	closed_at: string | null;
	resolution_notes: string | null;
	escalated: boolean;
	duplicate_of: string | null;
	minutes_remaining: number | null;
	is_overdue: boolean;
	photos: MaintenancePhoto[];
	// New fields (module 009 engineering)
	guest_impact: boolean;
	safety_impact: boolean;
	revenue_blocking: boolean;
	downtime: string | null;
	guest_safe_note: string | null;
	technical_notes: string | null;
	expected_completion_at: string | null;
	completed_at: string | null;
	released_at: string | null;
};

export type TicketListResult = {
	tickets: MaintenanceTicket[];
	counts: Partial<Record<MaintenanceState, number>>;
	overdue: number;
	categories: MaintenanceCategory[];
	priorities: MaintenancePriority[];
};

export type CreateTicketPayload = {
	resort_property: string;
	subject: string;
	category: MaintenanceCategory;
	priority: MaintenancePriority;
	room?: string | null;
	stay?: string | null;
	guest?: string | null;
	description?: string | null;
	photos?: MaintenancePhoto[];
	source_doctype?: string | null;
	source_name?: string | null;
	allow_duplicate?: boolean;
};

export type SimilarOpenWarning = {
	code: "similar_open";
	detail: { existing: string };
};

export type CreateTicketResult = {
	ticket: MaintenanceTicket;
	reused: boolean;
};

// ---------- low-level ----------

const BASE = "/api/method";
const NS = "the_reezort.maintenance.api";

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

/** Returns the full envelope so callers can read `warnings` (similar_open). */
async function callEnvelope<T>(
	method: string,
	init:
		| { method: "GET"; params?: Record<string, string | number | undefined> }
		| { method: "POST"; body: Record<string, unknown> },
): Promise<FolioApiEnvelope<T>> {
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
	return env;
}

async function callData<T>(
	method: string,
	init:
		| { method: "GET"; params?: Record<string, string | number | undefined> }
		| { method: "POST"; body: Record<string, unknown> },
): Promise<T> {
	const env = await callEnvelope<T>(method, init);
	return env.data as T;
}

// ---------- endpoints ----------

export function listTickets(filters: {
	resort_property?: string;
	state?: string;
	priority?: string;
	room?: string;
	assigned_to?: string;
	search?: string;
	limit?: number;
}): Promise<TicketListResult> {
	return callData<TicketListResult>("list_tickets", { method: "GET", params: { ...filters } });
}

export function getTicket(name: string): Promise<{ ticket: MaintenanceTicket }> {
	return callData("get_ticket", { method: "GET", params: { name } });
}

export function listRecentForRoom(room: string, limit = 5): Promise<{ room: string; tickets: MaintenanceTicket[] }> {
	return callData("list_recent_for_room", { method: "GET", params: { room, limit } });
}

/**
 * Creates a ticket. Returns the envelope so the caller can inspect
 * `warnings` for a `similar_open` duplicate hint (banner → resend with
 * allow_duplicate). `reused: true` means an idempotent same-minute repeat.
 */
export function createTicket(payload: CreateTicketPayload): Promise<FolioApiEnvelope<CreateTicketResult>> {
	// Backend signature is create_ticket(payload) — the fields go inside a single
	// `payload` dict (like add_folio_line), NOT flattened at the top level.
	return callEnvelope<CreateTicketResult>("create_ticket", { method: "POST", body: { payload } });
}

export function assignTicket(name: string, user: string): Promise<{ ticket: MaintenanceTicket }> {
	return callData("assign_ticket", { method: "POST", body: { name, user } });
}

export function addTicketNote(
	ticket: string,
	note: string,
	visibility: "Internal" | "Guest Safe" = "Internal",
): Promise<{ ticket: MaintenanceTicket }> {
	return callData("add_ticket_note", { method: "POST", body: { ticket, note, visibility } });
}

export function transitionTicket(
	name: string,
	next_state: MaintenanceState,
	notes?: string,
): Promise<{ ticket: MaintenanceTicket }> {
	return callData("transition_ticket", { method: "POST", body: { name, next_state, notes } });
}

/**
 * The primary Resort Property name — needed as create_ticket's resort_property
 * when the inbox is empty (no ticket to derive it from). Env-agnostic: reads
 * the actual Resort Property doctype (REEZORT on prod, RZ-DEMO on local) rather
 * than assuming a hardcoded default. Returns null if unreadable.
 */
export async function getPrimaryResortProperty(): Promise<string | null> {
	try {
		const res = await fetch(
			`${BASE}/frappe.client.get_list?doctype=Resort%20Property&fields=%5B%22name%22%5D&limit_page_length=1`,
			{ credentials: "include", headers: { Accept: "application/json" } },
		);
		const parsed = (await res.json()) as { message?: Array<{ name: string }> };
		return parsed.message?.[0]?.name ?? null;
	} catch {
		return null;
	}
}

// ---------- dev mock fixtures (network failure fallback) ----------

function mockTicket(over: Partial<MaintenanceTicket> & { name: string; subject: string }): MaintenanceTicket {
	return {
		resort_property: "REEZORT",
		description: null,
		state: "Reported",
		category: "HVAC",
		priority: "Normal",
		severity: null,
		room: null,
		stay: null,
		guest: null,
		raised_by: "frontdesk@thereezort.com",
		assigned_to: null,
		source_doctype: null,
		source_name: null,
		reported_at: "2026-07-02 12:00:00",
		sla_due: "2026-07-02 16:00:00",
		assigned_at: null,
		started_at: null,
		resolved_at: null,
		closed_at: null,
		resolution_notes: null,
		escalated: false,
		duplicate_of: null,
		minutes_remaining: 120,
		is_overdue: false,
		photos: [],
		guest_impact: false,
		safety_impact: false,
		revenue_blocking: false,
		downtime: null,
		guest_safe_note: null,
		technical_notes: null,
		expected_completion_at: null,
		completed_at: null,
		released_at: null,
		...over,
	};
}

export const MOCK_TICKETS: MaintenanceTicket[] = [
	mockTicket({ name: "RZ-MNT-2026-00001", subject: "AC not cooling", room: "REEZORT-V4", guest: "Aarav Sharma", category: "HVAC", priority: "High", state: "Assigned", assigned_to: "rakesh.tech@thereezort.com", minutes_remaining: 45 }),
	mockTicket({ name: "RZ-MNT-2026-00002", subject: "Bathroom tap dripping", room: "REEZORT-V1", category: "Plumbing", priority: "Normal", state: "Reported", raised_by: "housekeeping@thereezort.com", minutes_remaining: -30, is_overdue: true }),
	mockTicket({ name: "RZ-MNT-2026-00003", subject: "Corridor light flickering", room: "REEZORT-V7", category: "Electrical", priority: "Low", state: "In Progress", assigned_to: "rakesh.tech@thereezort.com", minutes_remaining: 200 }),
];

export const MOCK_LIST: TicketListResult = {
	tickets: MOCK_TICKETS,
	counts: { Reported: 1, Assigned: 1, "In Progress": 1 },
	overdue: 1,
	categories: ["HVAC", "Plumbing", "Electrical", "Structural", "IT", "Housekeeping Equipment", "Landscape", "Other"],
	priorities: ["Low", "Normal", "High", "Urgent"],
};
