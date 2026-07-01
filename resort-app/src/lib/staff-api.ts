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

// ---------- Leaves ----------

export type LeaveRow = {
	name: string;
	leave_type: string;
	from_date: string | null;
	to_date: string | null;
	total_leave_days: number;
	description: string | null;
	status: "Open" | "Approved" | "Rejected" | "Cancelled";
	docstatus: number;
};

export type LeaveBalance = {
	leave_type: string;
	max_days: number;
	used_days: number;
	remaining_days: number;
};

export type PendingLeaveRow = LeaveRow & {
	employee: string;
	employee_name: string;
	owner: string;
};

export type MyLeaves = {
	employee: string | null;
	leaves: LeaveRow[];
	balances: LeaveBalance[];
	is_manager: boolean;
};

export async function listMyLeaves(): Promise<MyLeaves> {
	return callStaff("the_reezort.staff.leave_api.list_my_leaves", { method: "GET" });
}

export async function listPendingLeaves(): Promise<{ leaves: PendingLeaveRow[] }> {
	return callStaff("the_reezort.staff.leave_api.list_pending_leaves", { method: "GET" });
}

export async function createLeaveRequest(payload: {
	leave_type: string;
	from_date: string;
	to_date: string;
	reason?: string;
}): Promise<{ leave: LeaveRow }> {
	return callStaff("the_reezort.staff.leave_api.create_leave_request", {
		method: "POST",
		body: payload,
	});
}

export async function cancelLeaveRequest(name: string): Promise<{ leave: string; cancelled: boolean }> {
	return callStaff("the_reezort.staff.leave_api.cancel_leave_request", {
		method: "POST",
		body: { name },
	});
}

export async function decideLeave(
	name: string,
	action: "Approve" | "Reject",
	notes?: string
): Promise<{ leave: LeaveRow }> {
	return callStaff("the_reezort.staff.leave_api.decide_leave", {
		method: "POST",
		body: { name, action, notes },
	});
}

// ---------- Advances ----------

export type AdvanceRow = {
	name: string;
	posting_date: string | null;
	advance_amount: number;
	paid_amount: number | null;
	purpose: string;
	status: "Draft" | "Paid" | "Unpaid" | "Claimed" | "Returned" | "Cancelled" | "Partly Claimed and Returned";
	docstatus: number;
};

export type PendingAdvanceRow = {
	name: string;
	employee: string;
	employee_name: string;
	posting_date: string | null;
	advance_amount: number;
	purpose: string;
	owner: string;
};

export type MyAdvances = {
	employee: string | null;
	advances: AdvanceRow[];
	outstanding: number;
	cap: number;
	is_manager: boolean;
};

export async function listMyAdvances(): Promise<MyAdvances> {
	return callStaff("the_reezort.staff.advance_api.list_my_advances", { method: "GET" });
}

export async function listPendingAdvances(): Promise<{ advances: PendingAdvanceRow[] }> {
	return callStaff("the_reezort.staff.advance_api.list_pending_advances", { method: "GET" });
}

export async function createAdvanceRequest(payload: {
	amount: number;
	purpose: string;
	posting_date?: string;
}): Promise<{ advance: AdvanceRow }> {
	return callStaff("the_reezort.staff.advance_api.create_advance_request", {
		method: "POST",
		body: payload,
	});
}

export async function cancelAdvanceRequest(name: string): Promise<{ advance: string; cancelled: boolean }> {
	return callStaff("the_reezort.staff.advance_api.cancel_advance_request", {
		method: "POST",
		body: { name },
	});
}

export async function decideAdvance(
	name: string,
	action: "Approve" | "Reject",
	notes?: string
): Promise<{ action: "Approved" | "Rejected"; advance?: AdvanceRow }> {
	return callStaff("the_reezort.staff.advance_api.decide_advance", {
		method: "POST",
		body: { name, action, notes },
	});
}

export async function markAdvancePaid(
	name: string,
	mode_of_payment: string,
	reference_no?: string,
	reference_date?: string
): Promise<{ advance: AdvanceRow; payment_entry: string }> {
	return callStaff("the_reezort.staff.advance_api.mark_advance_paid", {
		method: "POST",
		body: { name, mode_of_payment, reference_no, reference_date },
	});
}

// ---------- Payroll · Structures ----------

export type SalaryStructure = {
	name: string;
	company: string;
	currency: string;
	payroll_frequency: string;
};

export type SalaryAssignmentRow = {
	employee: string;
	employee_name: string;
	designation: string | null;
	company: string;
	date_of_joining: string | null;
	assignment: {
		name: string;
		salary_structure: string;
		base: number;
		from_date: string;
	} | null;
};

export async function listSalaryStructures(): Promise<{ structures: SalaryStructure[] }> {
	return callStaff("the_reezort.staff.payroll_api.list_salary_structures", { method: "GET" });
}

export async function listSalaryStructureAssignments(company?: string): Promise<{
	rows: SalaryAssignmentRow[];
	unassigned_count: number;
}> {
	return callStaff("the_reezort.staff.payroll_api.list_salary_structure_assignments", {
		method: "GET",
		params: company ? { company } : {},
	});
}

export async function assignSalaryStructure(payload: {
	employee: string;
	salary_structure: string;
	base: number;
	from_date?: string;
}): Promise<{ assignment: string; employee: string; salary_structure: string; base: number; from_date: string }> {
	return callStaff("the_reezort.staff.payroll_api.assign_salary_structure", { method: "POST", body: payload });
}

export async function deactivateSalaryStructureAssignment(name: string): Promise<{ assignment: string; cancelled: boolean }> {
	return callStaff("the_reezort.staff.payroll_api.deactivate_salary_structure_assignment", {
		method: "POST",
		body: { name },
	});
}

// ---------- Payroll · Payroll run + payslips ----------

export type PayslipRow = {
	name: string;
	start_date: string | null;
	end_date: string | null;
	salary_structure: string | null;
	gross_pay: number;
	total_deduction: number;
	net_pay: number;
};

export type MySlips = {
	employee: string | null;
	slips: PayslipRow[];
	is_manager: boolean;
};

export async function listMySlips(): Promise<MySlips> {
	return callStaff("the_reezort.staff.payroll_api.list_my_slips", { method: "GET" });
}

export type FullSlip = {
	name: string;
	employee: string;
	employee_name: string;
	designation: string | null;
	department: string | null;
	company: string;
	start_date: string;
	end_date: string;
	posting_date: string;
	salary_structure: string;
	payment_days: number;
	total_working_days: number;
	gross_pay: number;
	total_deduction: number;
	net_pay: number;
	currency: string;
	earnings: Array<{ component: string; amount: number }>;
	deductions: Array<{ component: string; amount: number }>;
};

export async function getSlip(name: string): Promise<{ slip: FullSlip }> {
	return callStaff("the_reezort.staff.payroll_api.get_slip", {
		method: "GET",
		params: { name },
	});
}

export type PayrollPreview = {
	company: string;
	period: string;
	frequency: string;
	start_date: string;
	end_date: string;
	included_count: number;
	skipped_count: number;
	slips_preview: Array<{
		employee: string;
		employee_name: string;
		salary_structure: string;
		base: number;
		gross_estimate: number;
	}>;
};

export async function previewPayroll(payload: {
	company: string;
	period: string;
	frequency?: string;
}): Promise<PayrollPreview> {
	return callStaff("the_reezort.staff.payroll_api.preview_payroll", { method: "POST", body: payload });
}

export type PayrollRunResult = {
	payroll_entry: string;
	start_date: string;
	end_date: string;
	slip_count: number;
	slips: Array<{
		name: string;
		employee: string;
		employee_name: string;
		gross_pay: number | null;
		net_pay: number | null;
		salary_structure: string | null;
	}>;
};

export async function runPayroll(payload: {
	company: string;
	period: string;
	frequency?: string;
}): Promise<PayrollRunResult> {
	return callStaff("the_reezort.staff.payroll_api.run_payroll", { method: "POST", body: payload });
}

export async function submitPayroll(payroll_entry: string): Promise<{
	payroll_entry: string;
	submitted_slip_count: number;
	total_net_pay: number;
	already_submitted?: boolean;
}> {
	return callStaff("the_reezort.staff.payroll_api.submit_payroll", { method: "POST", body: { payroll_entry } });
}
