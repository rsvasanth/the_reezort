/**
 * PMS API client for the_reezort.pms.api.* methods.
 * NOTE: PMS endpoints return BARE dicts (not the {ok,data,...} envelope).
 */

import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type CheckOutResult = {
	stay: string;
	stay_status: string;
	room: string | null;
	housekeeping_task: string | null;
	folio: string | null;
	reused: boolean;
};

export type CheckInResult = {
	stay: string;
	stay_status: string;
	folio: string;
	current_room: string | null;
	reused: boolean;
};

export type FrontDeskArrival = {
	reservation: string;
	guest: string;
	arrival_date: string | null;
	departure_date: string | null;
	room_type: string | null;
	nights: number | null;
	due_today: boolean;
};

export type FrontDeskInHouse = {
	stay: string;
	guest: string;
	room: string | null;
	arrival_date: string | null;
	departure_date: string | null;
	folio: string | null;
	folio_status: string | null;
	due_out: boolean;
};

export type FrontDeskBoard = {
	arrivals: FrontDeskArrival[];
	in_house: FrontDeskInHouse[];
	counts: { arrivals: number; in_house: number; due_out: number };
};

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

export async function checkOut(stay: string): Promise<CheckOutResult> {
	const response = await fetch(`${BASE}/the_reezort.pms.api.check_out`, {
		method: "POST",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
		},
		body: JSON.stringify({ stay }),
	});
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		// PMS validation errors surface as frappe.throw HTML/JSON — try for a message.
		const msg =
			(parsed as { exception?: string; _server_messages?: string } | undefined)?.exception ??
			`Checkout failed with ${response.status}`;
		throw new FolioApiError(msg, { status: response.status });
	}
	const data = (parsed as { message?: CheckOutResult } | undefined)?.message;
	if (!data) throw new FolioApiError("Checkout returned an unexpected body", { status: response.status });
	return data;
}

async function pmsCall<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
	let url = `${BASE}/${path}`;
	if (method === "GET" && body) {
		const search = new URLSearchParams();
		for (const [k, v] of Object.entries(body)) {
			if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
		}
		const qs = search.toString();
		if (qs) url += `?${qs}`;
	}
	const response = await fetch(url, {
		method,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			...(method === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
	});
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		const msg =
			(parsed as { exception?: string } | undefined)?.exception ?? `${path} failed with ${response.status}`;
		throw new FolioApiError(msg, { status: response.status });
	}
	const data = (parsed as { message?: T } | undefined)?.message;
	if (data === undefined) throw new FolioApiError(`${path} returned an unexpected body`, { status: response.status });
	return data;
}

export async function getFrontDeskBoard(resortProperty?: string): Promise<FrontDeskBoard> {
	return pmsCall<FrontDeskBoard>("the_reezort.pms.front_desk.get_front_desk_board", "GET", {
		resort_property: resortProperty,
	});
}

export async function checkIn(reservation: string): Promise<CheckInResult> {
	return pmsCall<CheckInResult>("the_reezort.pms.api.check_in", "POST", { reservation });
}

export type ExtendResult = {
	stay: string;
	new_departure_date: string;
	extra_nights: number;
	charge_added: string | null;
	folio: string | null;
};

export async function extendStay(stay: string, newDepartureDate: string): Promise<ExtendResult> {
	return pmsCall<ExtendResult>("the_reezort.pms.api.extend_stay", "POST", {
		stay,
		new_departure_date: newDepartureDate,
	});
}
