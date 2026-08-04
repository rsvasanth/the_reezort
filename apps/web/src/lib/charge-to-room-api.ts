/**
 * Generic outlet→room posting client — the_reezort.billing.room_posting.*
 * Envelope pattern ({ok, data}). Lets any department post an incidental to an
 * in-house guest's folio.
 */

import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export const POSTING_DEPARTMENTS = [
	"Spa",
	"Laundry",
	"Transport",
	"Recreation",
	"Business Center",
	"Telephone",
	"Minibar",
	"Misc",
] as const;

export type PostableRoom = {
	name: string;
	primary_guest_name: string | null;
	current_room: string | null;
	resort_property: string;
};

export type RoomPostingTarget = {
	postable: boolean;
	stay?: string;
	room?: string | null;
	guest_name?: string | null;
	folio?: string | null;
	folio_status?: string;
	reason?: string | null;
};

export type ChargePosted = {
	folio: string;
	folio_line: string;
	amount: number;
	department: string;
	guest_name: string | null;
};

const BASE = "/api/method/the_reezort.billing.room_posting";

function csrf(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

async function call<T>(method: string, verb: "GET" | "POST", params?: Record<string, unknown>): Promise<T> {
	let url = `${BASE}.${method}`;
	if (verb === "GET" && params) {
		const search = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
		}
		const qs = search.toString();
		if (qs) url += `?${qs}`;
	}
	const res = await fetch(url, {
		method: verb,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": csrf(),
			...(verb === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: verb === "POST" ? JSON.stringify(params ?? {}) : undefined,
	});
	const text = await res.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!res.ok) {
		const msg = (parsed as { exception?: string } | undefined)?.exception ?? `${method} failed with ${res.status}`;
		throw new FolioApiError(msg, { status: res.status });
	}
	const env = (parsed as { message?: { ok?: boolean; data?: T } } | undefined)?.message;
	if (!env || env.data === undefined) throw new FolioApiError(`${method} returned an unexpected body`, { status: res.status });
	return env.data;
}

export function listPostableRooms(search?: string): Promise<{ rooms: PostableRoom[] }> {
	return call("list_postable_rooms", "GET", { search });
}

export function validateRoomPostingTarget(stay: string): Promise<RoomPostingTarget> {
	return call("validate_room_posting_target", "GET", { stay });
}

export function postChargeToRoom(input: {
	stay: string;
	description: string;
	amount: number;
	department: string;
	qty?: number;
}): Promise<ChargePosted> {
	return call("post_charge_to_room", "POST", input);
}
