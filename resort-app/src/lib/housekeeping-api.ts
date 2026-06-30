/**
 * Housekeeping API client for the_reezort.housekeeping.* whitelisted methods.
 *
 * Mirrors the live-with-mock-fallback pattern in folio-api.ts:
 *   - raw fetch with credentials: "include"
 *   - throws on non-2xx, non-ok envelope, or empty body
 *   - returns the full envelope on success (caller unwraps .data)
 *
 * Common envelope: { ok, data, warnings, blockers, next_actions }
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

// Re-export so callers don't need to import from folio-api just for errors.
export { FolioApiError };
export type { FolioApiEnvelope, FolioMessage };

// ---------- Domain types ----------

export type HousekeepingStatus =
	| "Clean"
	| "Dirty"
	| "In Progress"
	| "Inspected"
	| "Pickup"
	| "Turndown Required"
	| "Out of Service Cleaning";

// Mirrors the Room `occupancy_status` Select options exactly.
export type OccupancyStatus =
	| "Vacant"
	| "Reserved"
	| "Occupied"
	| "Due In"
	| "Due Out"
	| "Checked Out"
	| "Hold";

// Mirrors the Room `maintenance_status` Select options exactly.
// "Available" is the no-active-maintenance sentinel.
export type MaintenanceStatus =
	| "Available"
	| "Maintenance Requested"
	| "Under Maintenance"
	| "Out of Order"
	| "Out of Service"
	| "Preventive Maintenance";

// Mirrors the Room `sellable_status` Select options exactly.
export type SellableStatus =
	| "Sellable"
	| "Not Sellable"
	| "Restricted"
	| "Temporarily Blocked";

// Mirrors the Housekeeping Task `task_type` Select options exactly.
export type TaskType =
	| "Departure Cleaning"
	| "Stayover Cleaning"
	| "Arrival Touch-up"
	| "Turndown"
	| "Deep Cleaning"
	| "Amenity Replenishment"
	| "Minibar Check"
	| "Linen Change"
	| "Room Inspection"
	| "Public Area Cleaning"
	| "Guest Request Support"
	| "Maintenance Follow-up";

// Mirrors the Housekeeping Task `task_status` Select options exactly.
export type TaskStatus =
	| "Draft"
	| "Queued"
	| "Assigned"
	| "In Progress"
	| "Paused"
	| "Completed"
	| "Inspection Required"
	| "Rework Required"
	| "Skipped"
	| "Cancelled";

export type TaskPriority = "Low" | "Normal" | "High" | "Urgent" | "VIP";

export type InspectionOutcome =
	| "Passed"
	| "Failed"
	| "Rework Required"
	| "Maintenance Required"
	| "Accepted With Exception";

export type OpenTask = {
	id: string;
	type: TaskType;
	status: TaskStatus;
	assignee: string | null;
	assigned_user: string | null;
	assigned_employee: string | null;
	priority: TaskPriority;
	due_at: string | null;
};

export type HousekeepingRoom = {
	name: string;
	room_number: string;
	room_name: string;
	building: string;
	floor: string;
	room_type: string;
	housekeeping_status: HousekeepingStatus;
	occupancy_status: OccupancyStatus;
	maintenance_status: MaintenanceStatus;
	sellable_status: SellableStatus;
	open_task: OpenTask | null;
};

export type HousekeepingBoard = {
	rooms: HousekeepingRoom[];
};

export type TaskResult = {
	task: OpenTask;
};

export type InspectionResult = {
	inspection: string;
};

// ---------- Create-task payload ----------

export type CreateTaskPayload = {
	room: string;
	task_type: TaskType;
	/** Required server-side for dedup; generate one per create intent. */
	idempotency_key: string;
	priority?: TaskPriority;
	due_at?: string | null;
	requires_inspection?: boolean;
	notes?: string | null;
};

export type AssignTaskPayload = {
	task: string;
	assigned_user?: string | null;
	assigned_employee?: string | null;
};

export type CompleteTaskPayload = {
	task: string;
	completion_notes?: string | null;
};

export type RecordInspectionPayload = {
	inspection: string;
	outcome: InspectionOutcome;
	notes?: string | null;
	checklist_result?: Record<string, boolean> | null;
};

// ---------- Low-level helpers ----------

const BASE = "/api/method";

function readCsrfToken(): string {
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

/**
 * Frappe whitelisted endpoints return either:
 *   { message: <envelope> }   — typical
 *   <envelope>                — direct (some setups)
 */
function unwrapFrappeMessage<T>(parsed: unknown): T | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const obj = parsed as Record<string, unknown>;
	if ("message" in obj) {
		return obj.message as T;
	}
	return parsed as T;
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	const envelope = unwrapFrappeMessage<FolioApiEnvelope<unknown>>(parsed);
	if (envelope && Array.isArray((envelope as Record<string, unknown>)[key])) {
		return (envelope as Record<string, unknown>)[key] as FolioMessage[];
	}
	return [];
}

function toQuery(params: Record<string, string | undefined>): string {
	const search = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== "") search.set(k, v);
	}
	return search.toString();
}

async function callHousekeeping<T>(
	path: string,
	init:
		| { method: "GET"; params: Record<string, string | undefined> }
		| { method: "POST"; body: Record<string, unknown> }
): Promise<FolioApiEnvelope<T>> {
	const url =
		init.method === "GET"
			? `${BASE}/${path}?${toQuery(init.params)}`
			: `${BASE}/${path}`;

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
		throw new FolioApiError(`Housekeeping ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrapFrappeMessage<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object") {
		throw new FolioApiError(`Housekeeping ${path} returned an empty body`, {
			status: response.status,
		});
	}

	return envelope;
}

// ---------- Public endpoints ----------

/**
 * Returns the full housekeeping board for a property.
 * data.rooms: HousekeepingRoom[]
 */
export async function getHousekeepingBoard(
	resort_property?: string
): Promise<FolioApiEnvelope<HousekeepingBoard>> {
	return callHousekeeping<HousekeepingBoard>(
		"the_reezort.housekeeping.api.get_housekeeping_board",
		{ method: "GET", params: resort_property ? { resort_property } : {} }
	);
}

/**
 * Creates a new housekeeping task for a room.
 */
export async function createTask(
	payload: CreateTaskPayload
): Promise<FolioApiEnvelope<TaskResult>> {
	return callHousekeeping<TaskResult>(
		"the_reezort.housekeeping.api.create_task",
		{ method: "POST", body: { payload } }
	);
}

/**
 * Assigns a task to a user or employee.
 */
export async function assignTask(
	task: string,
	assigned_user?: string | null,
	assigned_employee?: string | null
): Promise<FolioApiEnvelope<TaskResult>> {
	return callHousekeeping<TaskResult>("the_reezort.housekeeping.api.assign_task", {
		method: "POST",
		body: { task, assigned_user: assigned_user ?? null, assigned_employee: assigned_employee ?? null },
	});
}

/**
 * Starts an assigned task (status: Assigned → In Progress).
 */
export async function startTask(task: string): Promise<FolioApiEnvelope<TaskResult>> {
	return callHousekeeping<TaskResult>("the_reezort.housekeeping.api.start_task", {
		method: "POST",
		body: { task },
	});
}

/**
 * Pauses an in-progress task (status: In Progress → Paused).
 */
export async function pauseTask(task: string): Promise<FolioApiEnvelope<TaskResult>> {
	return callHousekeeping<TaskResult>("the_reezort.housekeeping.api.pause_task", {
		method: "POST",
		body: { task },
	});
}

/**
 * Completes a task (status: → Completed). Optional completion_notes.
 */
export async function completeTask(
	task: string,
	completion_notes?: string | null
): Promise<FolioApiEnvelope<TaskResult>> {
	return callHousekeeping<TaskResult>("the_reezort.housekeeping.api.complete_task", {
		method: "POST",
		body: { task, completion_notes: completion_notes ?? null },
	});
}

/**
 * Creates an inspection linked to a housekeeping task.
 */
export async function createInspection(
	housekeeping_task: string
): Promise<FolioApiEnvelope<InspectionResult>> {
	return callHousekeeping<InspectionResult>(
		"the_reezort.housekeeping.api.create_inspection",
		{ method: "POST", body: { housekeeping_task } }
	);
}

/**
 * Records the outcome of an inspection.
 * outcomes: Passed | Failed | Rework Required | Maintenance Required | Accepted With Exception
 */
export async function recordInspection(
	inspection: string,
	outcome: InspectionOutcome,
	notes?: string | null,
	checklist_result?: Record<string, boolean> | null
): Promise<FolioApiEnvelope<InspectionResult>> {
	return callHousekeeping<InspectionResult>(
		"the_reezort.housekeeping.api.record_inspection",
		{
			method: "POST",
			body: {
				inspection,
				outcome,
				notes: notes ?? null,
				checklist_result: checklist_result ?? null,
			},
		}
	);
}
