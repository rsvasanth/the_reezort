/**
 * Staff & Access API client for the_reezort.staff.api.* whitelisted methods.
 * Same transport as the other clients (credentials + CSRF, envelope unwrap).
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type StaffMember = {
	user: string;
	full_name: string;
	enabled: number;
	image: string | null;
	roles: string[];
	designation: string | null;
	department: string | null;
	employee: string | null;
	is_system_manager: boolean;
};

export type StaffOptions = {
	roles: string[];
	designations: string[];
	departments: string[];
};

export type CreateStaffPayload = {
	email: string;
	first_name: string;
	last_name?: string;
	roles: string[];
	password?: string;
	designation?: string | null;
	department?: string | null;
	full_name?: string;
};

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
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
	const obj = parsed as Record<string, unknown>;
	return "message" in obj ? (obj.message as T) : (parsed as T);
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	const env = unwrap<FolioApiEnvelope<unknown>>(parsed);
	const list = env && (env as Record<string, unknown>)[key];
	return Array.isArray(list) ? (list as FolioMessage[]) : [];
}

async function callStaff<T>(
	path: string,
	init: { method: "GET"; params?: Record<string, string | undefined> } | { method: "POST"; body: Record<string, unknown> }
): Promise<T> {
	let url = `${BASE}/${path}`;
	if (init.method === "GET" && init.params) {
		const search = new URLSearchParams();
		for (const [k, v] of Object.entries(init.params)) {
			if (v !== undefined && v !== null && v !== "") search.set(k, v);
		}
		const qs = search.toString();
		if (qs) url += `?${qs}`;
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
		throw new FolioApiError(`Staff ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Staff ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

export async function listStaff(): Promise<{ staff: StaffMember[]; count: number }> {
	return callStaff("the_reezort.staff.api.list_staff", { method: "GET" });
}

export async function listStaffOptions(): Promise<StaffOptions> {
	return callStaff("the_reezort.staff.api.list_staff_options", { method: "GET" });
}

export async function createStaff(
	payload: CreateStaffPayload
): Promise<{ user: StaffMember; employee: string | null; reused: boolean }> {
	return callStaff("the_reezort.staff.api.create_staff", { method: "POST", body: { payload } });
}

export async function updateStaffRoles(user: string, roles: string[]): Promise<{ user: StaffMember }> {
	return callStaff("the_reezort.staff.api.update_staff_roles", { method: "POST", body: { user, roles } });
}

export async function setStaffEnabled(user: string, enabled: boolean): Promise<{ user: string; enabled: number }> {
	return callStaff("the_reezort.staff.api.set_staff_enabled", {
		method: "POST",
		body: { user, enabled: enabled ? 1 : 0 },
	});
}

// ---------- Attendance & Roster ----------

export type AttendanceRow = {
	employee: string;
	employee_name: string;
	designation: string | null;
	image: string | null;
	user: string | null;
	clocked: "IN" | "OUT" | null;
	last_time: string | null;
	attendance_status: string | null;
	shift: string | null;
};

export type AttendanceBoard = {
	date: string;
	board: AttendanceRow[];
	statuses: string[];
};

export async function getAttendanceBoard(date?: string): Promise<AttendanceBoard> {
	return callStaff("the_reezort.staff.attendance_api.get_attendance_board", {
		method: "GET",
		params: date ? { date } : {},
	});
}

export async function clockIn(employee: string): Promise<{ employee: string; log_type: string }> {
	return callStaff("the_reezort.staff.attendance_api.clock_in", { method: "POST", body: { employee } });
}

export async function clockOut(employee: string): Promise<{ employee: string; log_type: string }> {
	return callStaff("the_reezort.staff.attendance_api.clock_out", { method: "POST", body: { employee } });
}

// ---------- Self-service: "my day" widget for any signed-in staff ----------

export type MyDay = {
	user: string;
	employee: string | null;
	employee_name: string | null;
	designation: string | null;
	date: string;
	clocked: "IN" | "OUT" | null;
	last_time: string | null;
	open_tasks: number;
};

export async function getMyDay(): Promise<MyDay> {
	return callStaff("the_reezort.staff.attendance_api.get_my_day", { method: "GET", params: {} });
}

export async function selfClockIn(): Promise<{ employee: string; log_type: string }> {
	return callStaff("the_reezort.staff.attendance_api.clock_in", { method: "POST", body: {} });
}

export async function selfClockOut(): Promise<{ employee: string; log_type: string }> {
	return callStaff("the_reezort.staff.attendance_api.clock_out", { method: "POST", body: {} });
}

export async function markAttendance(
	employee: string,
	status: string,
	date?: string
): Promise<{ attendance: string; status: string; reused: boolean }> {
	return callStaff("the_reezort.staff.attendance_api.mark_attendance", {
		method: "POST",
		body: { employee, status, date },
	});
}
