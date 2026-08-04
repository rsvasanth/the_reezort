/**
 * Approvals + Audit — SPA client for the compliance surface (spec 015).
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";

const BASE = "/api/method";

function readCsrfToken(): string {
	const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf_token"]');
	if (meta?.content) return meta.content;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as any;
	return w?.csrf_token || w?.frappe?.csrf_token || "";
}

function safeJson(text: string): unknown {
	try { return JSON.parse(text); } catch { return undefined; }
}

function unwrap<T>(parsed: unknown): T | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const shell = parsed as { message?: T };
	return shell.message;
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	const env = unwrap<FolioApiEnvelope<unknown>>(parsed);
	const list = env && (env as Record<string, unknown>)[key];
	return Array.isArray(list) ? (list as FolioMessage[]) : [];
}

async function call<T>(
	path: string,
	init: { method: "GET"; params?: Record<string, string | number | undefined | null> } | { method: "POST"; body: Record<string, unknown> },
): Promise<T> {
	let url = `${BASE}/${path}`;
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
		throw new FolioApiError(`${path} failed with ${res.status}`, {
			status: res.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}
	const env = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!env || typeof env !== "object" || env.data === undefined) {
		throw new FolioApiError(`${path} returned an unexpected body`, { status: res.status });
	}
	return env.data;
}

// ---------- Approvals ----------

export type ApprovalState = "Pending" | "Approved" | "Rejected" | "Auto-Approved" | "Cancelled";

export type ApprovalRequest = {
	name: string;
	policy: string;
	policy_name?: string | null;
	approver_role?: string | null;
	action: string;
	requester: string;
	requester_name?: string | null;
	requested_at: string;
	source_doctype: string;
	source_name: string;
	amount: number | null;
	reason: string | null;
	payload_json?: string | null;
	state?: ApprovalState;
	decided_at?: string | null;
	decision_notes?: string | null;
};

export async function listPendingForMe(): Promise<{ requests: ApprovalRequest[] }> {
	return call("the_reezort.approvals.api.list_pending_for_me", { method: "GET" });
}
export async function listAllOpenApprovals(): Promise<{ requests: ApprovalRequest[] }> {
	return call("the_reezort.approvals.api.list_all_open", { method: "GET" });
}
export async function listMyApprovalRequests(limit = 100): Promise<{ requests: ApprovalRequest[] }> {
	return call("the_reezort.approvals.api.list_my_requests", { method: "GET", params: { limit } });
}
export async function decideApprovalRequest(name: string, decision: "Approved" | "Rejected", notes?: string): Promise<{ request: ApprovalRequest }> {
	return call("the_reezort.approvals.api.decide_request", { method: "POST", body: { name, decision, notes: notes || "" } });
}

// ---------- Audit ----------

export type AuditEvent = {
	name: string;
	at: string;
	actor: string | null;
	actor_name: string | null;
	action: string;
	source_doctype: string | null;
	source_name: string | null;
	reason: string | null;
	details: string | null;
	details_parsed?: Record<string, unknown>;
};

export async function listAuditEvents(params?: {
	action?: string;
	actor?: string;
	source_doctype?: string;
	days?: number;
	limit?: number;
}): Promise<{ events: AuditEvent[] }> {
	return call("the_reezort.audit.api.list_audit_events", { method: "GET", params: { ...params } });
}
export async function listAuditActions(): Promise<{ actions: string[] }> {
	return call("the_reezort.audit.api.list_actions", { method: "GET" });
}
