/**
 * Guest Services API client — module 010.
 * Backs the Guest Relations console (GuestRelations.tsx).
 *
 * Backend: the_reezort.guest_services.api.*  (requests)
 *          the_reezort.guest_services.recovery.*  (complaints / recovery / handoff)
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

// ---------- Domain enums (must match doctype Select options exactly) ----------

/** Mirror of Guest Request.status */
export type GuestRequestStatus =
	| "New"
	| "Acknowledged"
	| "Assigned"
	| "In Progress"
	| "Waiting for Guest"
	| "Waiting for Department"
	| "Waiting for Vendor"
	| "Escalated"
	| "Completed"
	| "Verified"
	| "Reopened"
	| "Closed"
	| "Cancelled";

/** Mirror of Guest Request.priority */
export type GuestRequestPriority = "Low" | "Normal" | "High" | "Urgent" | "VIP" | "Safety";

/** Mirror of Guest Request.source */
export type GuestRequestSource =
	| "Staff"
	| "Guest Portal"
	| "QR"
	| "Phone"
	| "Email"
	| "WhatsApp"
	| "SMS"
	| "In Person"
	| "Department"
	| "Integration";

/** Mirror of Guest Request.department (also Guest Complaint.department) */
export type ServiceDepartment =
	| "Front Desk"
	| "Concierge"
	| "Housekeeping"
	| "Maintenance"
	| "F&B"
	| "Events"
	| "Billing"
	| "Security"
	| "Transport"
	| "Other";

/** Mirror of Guest Request.privacy_level */
export type PrivacyLevel = "Normal" | "Private" | "VIP" | "Security" | "Medical";

/** Mirror of Guest Request.guest_satisfaction */
export type RequestSatisfaction = "Satisfied" | "Neutral" | "Not Satisfied" | "Reopened";

/** Mirror of Guest Complaint.status */
export type ComplaintStatus =
	| "Open"
	| "Acknowledged"
	| "Investigating"
	| "Waiting for Guest"
	| "Waiting for Department"
	| "Recovery Proposed"
	| "Recovery Approved"
	| "Resolved"
	| "Reopened"
	| "Escalated"
	| "Closed";

/** Mirror of Guest Complaint.complaint_category */
export type ComplaintCategory =
	| "Room"
	| "Housekeeping"
	| "Maintenance"
	| "F&B"
	| "Billing"
	| "Staff"
	| "Noise"
	| "Safety"
	| "Delay"
	| "Event"
	| "Other";

/** Mirror of Guest Complaint.severity */
export type ComplaintSeverity = "Low" | "Medium" | "High" | "Critical";

/** Mirror of Guest Complaint.guest_satisfaction */
export type ComplaintSatisfaction = "Satisfied" | "Neutral" | "Not Satisfied" | "Unknown";

/** Mirror of Service Recovery Action.recovery_type */
export type RecoveryType =
	| "Apology"
	| "Amenity"
	| "Room Move"
	| "Complimentary Item"
	| "Discount"
	| "Refund Request"
	| "Loyalty Credit"
	| "Manager Call"
	| "Other";

/** Mirror of Service Recovery Action.status */
export type RecoveryStatus =
	| "Draft"
	| "Pending Approval"
	| "Approved"
	| "Rejected"
	| "In Progress"
	| "Completed"
	| "Cancelled"
	| "Posted to Billing";

/** Mirror of Service Handoff.target_module */
export type HandoffTargetModule =
	| "Housekeeping"
	| "Maintenance"
	| "F&B"
	| "Billing"
	| "Events"
	| "Integrations"
	| "Security"
	| "Spa Parked";

/** Mirror of Service Handoff.status */
export type HandoffStatus =
	| "Pending"
	| "Created"
	| "Accepted"
	| "Failed"
	| "Retrying"
	| "Completed"
	| "Cancelled";

// ---------- Shape types ----------

export type GuestRequest = {
	name: string;
	resort_property: string;
	request_type: string;
	status: GuestRequestStatus;
	priority: GuestRequestPriority;
	source: GuestRequestSource | null;
	department: ServiceDepartment;
	subject: string;
	room: string | null;
	stay: string | null;
	reservation: string | null;
	guest_profile: string | null;
	guest_folio: string | null;
	assigned_to: string | null;
	response_due_at: string | null;
	resolution_due_at: string | null;
	acknowledged_at: string | null;
	completed_at: string | null;
	closed_at: string | null;
	guest_satisfaction: RequestSatisfaction | null;
	privacy_level: PrivacyLevel;
	guest_visible_notes: string | null;
};

export type GuestComplaint = {
	name: string;
	resort_property: string;
	complaint_summary: string;
	status: ComplaintStatus;
	complaint_category: ComplaintCategory;
	severity: ComplaintSeverity;
	department: ServiceDepartment;
	room: string | null;
	stay: string | null;
	reservation: string | null;
	guest_profile: string | null;
	owner_user: string;
	response_due_at: string | null;
	resolution_due_at: string | null;
	complaint_details: string;
	desired_resolution: string | null;
	resolution_summary: string | null;
	guest_satisfaction: ComplaintSatisfaction;
	legal_or_safety_risk: 0 | 1;
};

export type ServiceConsole = {
	requests: GuestRequest[];
	complaints: GuestComplaint[];
	sla_exceptions: GuestRequest[];
	counts: {
		open_requests: number;
		open_complaints: number;
		sla_exceptions: number;
		by_status: Record<string, number>;
		by_priority: Record<string, number>;
	};
	vip_preparation: unknown[];
};

export type CreateRequestPayload = {
	property: string;
	request_type: string;
	subject: string;
	source?: GuestRequestSource;
	stay?: string;
	room?: string;
	reservation?: string;
	guest_profile?: string;
	guest_folio?: string;
	department?: ServiceDepartment;
	priority?: GuestRequestPriority;
	guest_visible_notes?: string;
	internal_notes?: string;
	privacy_level?: PrivacyLevel;
	source_reference?: string;
};

export type CreateComplaintPayload = {
	property: string;
	category: ComplaintCategory;
	severity: ComplaintSeverity;
	summary: string;
	details: string;
	desired_resolution?: string;
	stay?: string;
	room?: string;
	reservation?: string;
	guest_profile?: string;
	legal_or_safety_risk?: boolean;
};

export type ProposeRecoveryPayload = {
	guest_complaint: string;
	recovery_type: RecoveryType;
	estimated_value?: number;
	reason: string;
	requires_billing_handoff?: boolean;
};

export type CreateHandoffPayload = {
	source_doctype: string;
	source_name: string;
	target_module: HandoffTargetModule;
	handoff_payload?: Record<string, unknown>;
};

// ---------- Transport ----------

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

function toQuery(params: Record<string, string | undefined>): string {
	const s = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== "") s.set(k, v);
	}
	return s.toString();
}

async function callGs<T>(
	path: string,
	init:
		| { method: "GET"; params?: Record<string, string | undefined> }
		| { method: "POST"; body: Record<string, unknown> }
): Promise<T> {
	const url =
		init.method === "GET" && init.params
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
		throw new FolioApiError(`Guest Services ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Guest Services ${path} returned an unexpected body`, {
			status: response.status,
		});
	}
	return envelope.data;
}

// ---------- Endpoints ----------

export async function getServiceConsole(
	resortProperty: string,
	filters?: Record<string, string>
): Promise<ServiceConsole> {
	return callGs<ServiceConsole>("the_reezort.guest_services.api.get_service_console", {
		method: "GET",
		params: { resort_property: resortProperty, ...filters },
	});
}

export async function createGuestRequest(
	payload: CreateRequestPayload
): Promise<{
	guest_request: string;
	status: GuestRequestStatus;
	priority: GuestRequestPriority;
	department: ServiceDepartment;
	response_due_at: string | null;
	resolution_due_at: string | null;
}> {
	return callGs("the_reezort.guest_services.api.create_guest_request", {
		method: "POST",
		body: { payload },
	});
}

export async function assignGuestRequest(
	guestRequest: string,
	assignedTo: string,
	department?: ServiceDepartment,
	reason?: string
): Promise<{ guest_request: string; status: GuestRequestStatus; assigned_to: string }> {
	return callGs("the_reezort.guest_services.api.assign_guest_request", {
		method: "POST",
		body: { guest_request: guestRequest, assigned_to: assignedTo, department, reason },
	});
}

export async function updateGuestRequestStatus(
	guestRequest: string,
	status: GuestRequestStatus,
	note?: string
): Promise<{ guest_request: string; status: GuestRequestStatus }> {
	return callGs("the_reezort.guest_services.api.update_guest_request_status", {
		method: "POST",
		body: { guest_request: guestRequest, status, note },
	});
}

export async function verifyGuestRequest(
	guestRequest: string,
	satisfaction: "Satisfied" | "Neutral" | "Not Satisfied"
): Promise<{ guest_request: string; status: GuestRequestStatus; guest_satisfaction: RequestSatisfaction }> {
	return callGs("the_reezort.guest_services.api.verify_guest_request", {
		method: "POST",
		body: { guest_request: guestRequest, satisfaction },
	});
}

export async function createComplaint(
	payload: CreateComplaintPayload
): Promise<{ guest_complaint: string; status: ComplaintStatus; escalated: boolean }> {
	return callGs("the_reezort.guest_services.recovery.create_complaint", {
		method: "POST",
		body: payload,
	});
}

export async function updateComplaintStatus(
	guestComplaint: string,
	status: ComplaintStatus,
	resolutionSummary?: string
): Promise<{ guest_complaint: string; status: ComplaintStatus }> {
	return callGs("the_reezort.guest_services.recovery.update_complaint_status", {
		method: "POST",
		body: { guest_complaint: guestComplaint, status, resolution_summary: resolutionSummary },
	});
}

export async function proposeServiceRecovery(
	payload: ProposeRecoveryPayload
): Promise<{
	service_recovery_action: string;
	status: RecoveryStatus;
	approval_required: boolean;
}> {
	return callGs("the_reezort.guest_services.recovery.propose_service_recovery", {
		method: "POST",
		body: payload,
	});
}

export async function createServiceHandoff(
	payload: CreateHandoffPayload
): Promise<{
	service_handoff: string;
	status: HandoffStatus;
	target_doctype: string | null;
	target_name: string | null;
}> {
	return callGs("the_reezort.guest_services.recovery.create_service_handoff", {
		method: "POST",
		body: payload,
	});
}
