/**
 * Preventive Maintenance API client (spec 009).
 *
 * Endpoints: the_reezort.maintenance.preventive.*
 * Same envelope-unwrapping + CSRF pattern as maintenance-api.ts.
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";

// ---------- doctype-mirrored unions (parity-guarded) ----------

export type PlanScope =
	| "Room"
	| "Room Type"
	| "Asset"
	| "Asset Category"
	| "Building"
	| "Floor"
	| "Outlet"
	| "Facility"
	| "Vehicle"
	| "Utility";

export type RecurrenceType =
	| "Daily"
	| "Weekly"
	| "Monthly"
	| "Quarterly"
	| "Annual"
	| "Runtime Based"
	| "Seasonal"
	| "Manual";

export type PmTaskStatus =
	| "Scheduled"
	| "Generated"
	| "In Progress"
	| "Completed"
	| "Missed"
	| "Cancelled";

// ---------- shapes ----------

export type PreventivePlan = {
	name: string;
	plan_name: string;
	property: string;
	active: boolean;
	plan_scope: PlanScope;
	recurrence_type: RecurrenceType;
	next_due_date: string;
	room: string | null;
	room_type: string | null;
	erpnext_asset: string | null;
	asset_category: string | null;
	expected_minutes: number | null;
	responsible_team: string | null;
};

export type PreventiveTask = {
	name: string;
	preventive_plan: string;
	due_date: string;
	task_status: PmTaskStatus;
	maintenance_ticket: string | null;
	generated_at: string | null;
	completed_at: string | null;
};

export type CreatePlanPayload = {
	plan_name: string;
	property: string;
	plan_scope: PlanScope;
	recurrence_type: RecurrenceType;
	next_due_date: string;
	room?: string | null;
	room_type?: string | null;
	erpnext_asset?: string | null;
	asset_category?: string | null;
	expected_minutes?: number | null;
	responsible_team?: string | null;
};

// ---------- low-level ----------

const BASE = "/api/method";
const NS = "the_reezort.maintenance.preventive";

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

export function listPreventivePlans(property: string): Promise<{ plans: PreventivePlan[] }> {
	return callData("list_preventive_plans", { method: "GET", params: { property } });
}

export function listPreventiveTasks(
	property: string,
	filters?: {
		plan?: string;
		task_status?: string;
		due_date_from?: string;
		due_date_to?: string;
	},
): Promise<{ tasks: PreventiveTask[] }> {
	return callData("list_preventive_tasks", {
		method: "GET",
		params: { property, ...filters },
	});
}

export function createPreventivePlan(payload: CreatePlanPayload): Promise<{ plan: PreventivePlan }> {
	return callData("create_preventive_plan", { method: "POST", body: { payload } });
}

export function generatePreventiveTasks(
	property: string,
	through_date: string,
): Promise<{ generated: PreventiveTask[]; skipped: string[]; generated_count: number; skipped_count: number }> {
	return callData("generate_preventive_tasks", {
		method: "POST",
		body: { property, through_date },
	});
}

// ---------- mock data ----------

export const MOCK_PLANS: PreventivePlan[] = [
	{
		name: "RZ-PMP-2026-00001",
		plan_name: "AC Filter Cleaning — Villas",
		property: "REEZORT",
		active: true,
		plan_scope: "Room Type",
		recurrence_type: "Monthly",
		next_due_date: "2026-07-15",
		room: null,
		room_type: "Villa",
		erpnext_asset: null,
		asset_category: null,
		expected_minutes: 30,
		responsible_team: "Engineering",
	},
	{
		name: "RZ-PMP-2026-00002",
		plan_name: "Pool Pump Inspection",
		property: "REEZORT",
		active: true,
		plan_scope: "Facility",
		recurrence_type: "Weekly",
		next_due_date: "2026-07-12",
		room: null,
		room_type: null,
		erpnext_asset: null,
		asset_category: null,
		expected_minutes: 45,
		responsible_team: "Engineering",
	},
];

export const MOCK_TASKS: PreventiveTask[] = [
	{
		name: "RZ-PMT-2026-00001",
		preventive_plan: "RZ-PMP-2026-00001",
		due_date: "2026-07-15",
		task_status: "Scheduled",
		maintenance_ticket: null,
		generated_at: null,
		completed_at: null,
	},
	{
		name: "RZ-PMT-2026-00002",
		preventive_plan: "RZ-PMP-2026-00002",
		due_date: "2026-07-12",
		task_status: "Generated",
		maintenance_ticket: "RZ-MNT-2026-00010",
		generated_at: "2026-07-11 08:00:00",
		completed_at: null,
	},
];
