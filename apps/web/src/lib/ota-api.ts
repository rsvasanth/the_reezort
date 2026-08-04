/**
 * OTA reservation ingest API client — the_reezort.integrations.ota.api.*
 * (spec 013). Standard envelope, live-with-mock-fallback. String unions mirror
 * the OTA Reservation Message doctype Selects and are parity-guarded.
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";

// ---------- doctype-mirrored unions (parity-guarded) ----------

export type OtaMessageState = "New" | "Converted" | "Rejected" | "Dead-letter";

export type OtaSource = "Booking.com" | "Expedia" | "Airbnb" | "Agoda" | "GDS" | "Manual";

// ---------- shapes ----------

export type OtaMessage = {
	name: string;
	source: OtaSource;
	external_id: string;
	state: OtaMessageState;
	received_at: string | null;
	processed_at: string | null;
	batch: string | null;
	parsed_guest_name: string | null;
	parsed_email: string | null;
	parsed_phone: string | null;
	parsed_adults: number | null;
	parsed_children: number | null;
	parsed_arrival: string | null;
	parsed_departure: string | null;
	parsed_room_type_code: string | null;
	parsed_rate_code: string | null;
	parsed_total: number | null;
	parsed_currency: string | null;
	converted_reservation: string | null;
	rejection_reason: string | null;
	dead_letter_error: string | null;
	notes: string | null;
};

export type SimilarReservation = {
	reservation: string;
	match: "external_id" | "guest_and_dates";
	status: string;
	arrival_date: string | null;
	departure_date: string | null;
};

export type InboxResult = {
	messages: OtaMessage[];
	counts: Record<OtaMessageState, number>;
	sources: OtaSource[];
};

export type MessageDetail = {
	message: OtaMessage;
	raw_payload: string;
	similar_reservations: SimilarReservation[];
};

export type IngestResult = {
	batch: string;
	row_count: number;
	success_count: number;
	duplicate_count: number;
	dead_letter_count: number;
	reused: boolean;
};

// ---------- low-level ----------

const BASE = "/api/method";
const NS = "the_reezort.integrations.ota.api";

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

async function call<T>(
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
		throw new FolioApiError(`${method} returned an unexpected body`, { status: res.status });
	}
	return env.data as T;
}

// ---------- endpoints ----------

export function listInbox(filters: {
	state?: string;
	source?: string;
	search?: string;
	resort_property?: string;
	limit?: number;
}): Promise<InboxResult> {
	return call<InboxResult>("list_inbox", { method: "GET", params: { ...filters } });
}

export function getMessage(name: string): Promise<MessageDetail> {
	return call<MessageDetail>("get_message", { method: "GET", params: { name } });
}

export function ingestPayload(input: {
	source: OtaSource;
	payload: string;
	filename?: string;
	resort_property?: string;
}): Promise<IngestResult> {
	return call<IngestResult>("ingest_payload", { method: "POST", body: { ...input } });
}

export function convertToReservation(name: string, resort_property?: string): Promise<{ message: OtaMessage; reservation: string }> {
	return call("convert_to_reservation", { method: "POST", body: { name, resort_property } });
}

export function rejectMessage(name: string, reason: string): Promise<{ message: OtaMessage }> {
	return call("reject_message", { method: "POST", body: { name, reason } });
}

// ---------- dev mock fixtures ----------

function mockMsg(over: Partial<OtaMessage> & { name: string; external_id: string; parsed_guest_name: string }): OtaMessage {
	return {
		source: "Booking.com",
		state: "New",
		received_at: "2026-07-02 09:00:00",
		processed_at: null,
		batch: "RZ-OTABATCH-2026-00001",
		parsed_email: null,
		parsed_phone: null,
		parsed_adults: 2,
		parsed_children: 0,
		parsed_arrival: "2026-07-10",
		parsed_departure: "2026-07-13",
		parsed_room_type_code: "SAV",
		parsed_rate_code: "BAR",
		parsed_total: 51000,
		parsed_currency: "INR",
		converted_reservation: null,
		rejection_reason: null,
		dead_letter_error: null,
		notes: null,
		...over,
	};
}

export const MOCK_INBOX: InboxResult = {
	messages: [
		mockMsg({ name: "RZ-OTA-2026-00001", external_id: "BDC-88213", parsed_guest_name: "Aarav Sharma", source: "Booking.com", state: "New" }),
		mockMsg({ name: "RZ-OTA-2026-00002", external_id: "BDC-88219", parsed_guest_name: "Diya Nair", source: "Booking.com", state: "New", parsed_total: 38000 }),
		mockMsg({ name: "RZ-OTA-2026-00003", external_id: "EXP-55120", parsed_guest_name: "Rita Kulkarni", source: "Expedia", state: "New", parsed_total: 62000 }),
		mockMsg({ name: "RZ-OTA-2026-00004", external_id: "EXP-55121", parsed_guest_name: "Rohit Verma", source: "Expedia", state: "Converted", converted_reservation: "RZ-RES-2026-00099", processed_at: "2026-07-02 10:15:00" }),
		mockMsg({ name: "RZ-OTA-2026-00005", external_id: "BDC-88301", parsed_guest_name: "Prashant Rao", source: "Booking.com", state: "Rejected", rejection_reason: "Duplicate of a direct booking" }),
		mockMsg({ name: "RZ-OTA-2026-00006", external_id: "EXP-55130", parsed_guest_name: "—", source: "Expedia", state: "Dead-letter", dead_letter_error: "Missing guest_name column" }),
	],
	counts: { New: 3, Converted: 1, Rejected: 1, "Dead-letter": 1 },
	sources: ["Booking.com", "Expedia", "Airbnb", "Agoda", "GDS", "Manual"],
};
