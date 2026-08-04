/**
 * Service Desk API client for the_reezort.servicedesk.api.* whitelisted methods.
 * Unified ticketing with SLA. Same transport as the other clients.
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type TicketStatus = "Open" | "In Progress" | "On Hold" | "Resolved" | "Closed" | "Cancelled";
export type TicketPriority = "Low" | "Normal" | "High" | "Urgent";

export type ServiceTicket = {
	name: string;
	resort_property: string;
	subject: string;
	category: string;
	priority: TicketPriority;
	status: TicketStatus;
	description: string | null;
	room: string | null;
	guest: string | null;
	stay: string | null;
	source: string | null;
	assigned_to: string | null;
	opened_at: string | null;
	sla_due: string | null;
	resolved_at: string | null;
	escalated: number;
	minutes_remaining: number | null;
	is_overdue: boolean;
};

export type ServiceBoard = {
	tickets: ServiceTicket[];
	counts: Record<string, number>;
	overdue: number;
	categories: string[];
	statuses: TicketStatus[];
	priorities: TicketPriority[];
};

export type CreateTicketPayload = {
	resort_property: string;
	subject: string;
	category: string;
	priority: TicketPriority;
	source?: string;
	description?: string | null;
	room?: string | null;
	idempotency_key: string;
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

async function callDesk<T>(
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
		throw new FolioApiError(`Service Desk ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}
	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Service Desk ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

export async function getServiceBoard(resortProperty?: string, status?: string): Promise<ServiceBoard> {
	return callDesk("the_reezort.servicedesk.api.get_service_board", {
		method: "GET",
		params: { resort_property: resortProperty, status },
	});
}

export async function createTicket(payload: CreateTicketPayload): Promise<{ ticket: ServiceTicket; reused: boolean }> {
	return callDesk("the_reezort.servicedesk.api.create_ticket", { method: "POST", body: { payload } });
}

export async function assignTicket(ticket: string, assignedTo: string): Promise<{ ticket: ServiceTicket }> {
	return callDesk("the_reezort.servicedesk.api.assign_ticket", {
		method: "POST",
		body: { ticket, assigned_to: assignedTo },
	});
}

export async function updateTicketStatus(ticket: string, status: string): Promise<{ ticket: ServiceTicket }> {
	return callDesk("the_reezort.servicedesk.api.update_status", { method: "POST", body: { ticket, status } });
}
