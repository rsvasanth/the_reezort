/**
 * Public guest-booking API client — the_reezort.reservation.guest_booking.*
 * These endpoints are allow_guest=True, so the public booking flow works with
 * no login/session. Bare-dict responses (unwrap `.message`).
 */

export class GuestBookingError extends Error {}

export type BookingOffer = {
	room_type: string;
	room_type_name: string;
	image: string | null;
	available_count: number;
	currency: string | null;
	total_amount: number;
	max_occupancy: number;
	fits_party: boolean;
};

export type SearchResult = {
	property: string;
	property_name: string;
	arrival_date: string;
	departure_date: string;
	nights: number;
	currency: string | null;
	offers: BookingOffer[];
};

export type BookingRequestResult = {
	reference: string;
	status: string;
	guest_name: string;
	arrival_date: string;
	departure_date: string;
	room_type_name: string;
	nights: number;
	estimated_total: number;
	currency: string | null;
};

export type BookingLookup = {
	reference: string;
	status: string;
	arrival_date: string | null;
	departure_date: string | null;
	room_type_name: string | null;
	guest_name: string | null;
	deposit_status: string | null;
	currency: string | null;
	total_estimated_amount: number;
};

export type Booker = { full_name: string; email: string; phone: string };

const BASE = "/api/method/the_reezort.reservation.guest_booking";

function csrf(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

async function call<T>(
	method: string,
	verb: "GET" | "POST",
	params?: Record<string, unknown>,
): Promise<T> {
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
			// Guest sessions don't require CSRF; send it when present for logged-in previews.
			...(csrf() ? { "X-Frappe-CSRF-Token": csrf() } : {}),
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
		const exc = (parsed as { exception?: string; _server_messages?: string } | undefined)?.exception;
		let msg = exc || `Request failed (${res.status})`;
		// Frappe packs frappe.throw messages into _server_messages as JSON strings.
		const sm = (parsed as { _server_messages?: string } | undefined)?._server_messages;
		if (sm) {
			try {
				const first = JSON.parse(sm)[0];
				const parsedMsg = JSON.parse(first)?.message;
				if (parsedMsg) msg = parsedMsg;
			} catch {
				/* keep msg */
			}
		}
		throw new GuestBookingError(msg);
	}
	return (parsed as { message?: T } | undefined)?.message as T;
}

export function guestSearch(input: {
	property?: string;
	arrival_date: string;
	departure_date: string;
	adults: number;
	children: number;
}): Promise<SearchResult> {
	return call<SearchResult>("guest_search", "GET", input);
}

export function guestRequestBooking(input: {
	property?: string;
	arrival_date: string;
	departure_date: string;
	room_type: string;
	quantity: number;
	adults: number;
	children: number;
	booker: Booker;
}): Promise<BookingRequestResult> {
	return call<BookingRequestResult>("guest_request_booking", "POST", input);
}

export function guestLookupBooking(reference: string, email: string): Promise<BookingLookup> {
	return call<BookingLookup>("guest_lookup_booking", "GET", { reference, email });
}
