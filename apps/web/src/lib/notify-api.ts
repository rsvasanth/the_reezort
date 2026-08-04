/**
 * User notifications — client wrapper over staff.notify_api.
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
	init: { method: "GET"; params?: Record<string, string | number | undefined> } | { method: "POST"; body: Record<string, unknown> },
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
		throw new FolioApiError(`Notify ${path} failed with ${res.status}`, {
			status: res.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Notify ${path} returned an unexpected body`, { status: res.status });
	}
	return envelope.data;
}

// ---------- shape ----------

export type NotificationRow = {
	name: string;
	subject: string;
	type: "Alert" | "Assignment" | "Share" | "Mention" | "Event" | "Energy Point" | string;
	read: number;
	document_type: string | null;
	document_name: string | null;
	creation: string | null;
	from_user: string | null;
};

export type NotificationList = { notifications: NotificationRow[]; unread_count: number };

export async function listMyNotifications(unreadOnly = false, limit = 30): Promise<NotificationList> {
	return call("the_reezort.staff.notify_api.list_my_notifications", {
		method: "GET",
		params: { unread_only: unreadOnly ? 1 : 0, limit },
	});
}

export async function getUnreadCount(): Promise<{ unread_count: number }> {
	return call("the_reezort.staff.notify_api.get_unread_count", { method: "GET" });
}

export async function markNotificationRead(name: string): Promise<{ name: string; read: boolean }> {
	return call("the_reezort.staff.notify_api.mark_read", { method: "POST", body: { name } });
}

export async function markAllNotificationsRead(): Promise<{ cleared: number }> {
	return call("the_reezort.staff.notify_api.mark_all_read", { method: "POST", body: {} });
}

/** Deep link a notification to its source doc — desk record in a new tab. */
export function deskUrlForNotification(n: NotificationRow): string | null {
	if (!n.document_type || !n.document_name) return null;
	const slug = n.document_type.toLowerCase().replace(/\s+/g, "-");
	return `/app/${slug}/${encodeURIComponent(n.document_name)}`;
}
