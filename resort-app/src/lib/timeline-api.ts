/**
 * Engagement timeline client — reads the aggregated event stream for a
 * Room / Property / Building / Floor from the_reezort.property.timeline_api.
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
	params?: Record<string, string | number | undefined>,
): Promise<T> {
	let url = `${BASE}/${path}`;
	if (params) {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
		}
		const qs = q.toString();
		if (qs) url += `?${qs}`;
	}

	const res = await fetch(url, {
		method: "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
		},
	});
	const text = await res.text();
	const parsed = text ? safeJson(text) : undefined;

	if (!res.ok) {
		throw new FolioApiError(`Timeline ${path} failed with ${res.status}`, {
			status: res.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Timeline ${path} returned an unexpected body`, { status: res.status });
	}
	return envelope.data;
}

// ---------- shape ----------

export type TimelineEventKind =
	| "reservation"
	| "stay"
	| "folio"
	| "payment"
	| "housekeeping"
	| "condition"
	| "move"
	| "ticket";

export type TimelineEvent = {
	kind: TimelineEventKind;
	when: string | null;
	title: string;
	subtitle: string | null;
	source_doctype: string;
	source_name: string;
	actor: string | null;
	amount: number | null;
	room: string | null;
	status: string | null;
};

export type TimelineTarget = { doctype: string; name: string };
export type TimelinePayload = { target: TimelineTarget; events: TimelineEvent[] };

export async function getRoomTimeline(room: string, limit?: number): Promise<TimelinePayload> {
	return call("the_reezort.property.timeline_api.get_room_timeline", { room, limit });
}
export async function getPropertyTimeline(resort_property: string, limit?: number): Promise<TimelinePayload> {
	return call("the_reezort.property.timeline_api.get_property_timeline", { resort_property, limit });
}
export async function getBuildingTimeline(resort_building: string, limit?: number): Promise<TimelinePayload> {
	return call("the_reezort.property.timeline_api.get_building_timeline", { resort_building, limit });
}
export async function getFloorTimeline(resort_floor: string, limit?: number): Promise<TimelinePayload> {
	return call("the_reezort.property.timeline_api.get_floor_timeline", { resort_floor, limit });
}
