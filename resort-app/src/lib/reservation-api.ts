/**
 * Reservation API client for the_reezort.reservation.api.* methods.
 * The booking pipeline: search availability → hold → confirm. Bare dicts (not enveloped).
 */

import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

export type AvailabilityOffer = {
	room_type: string;
	available_count: number;
	rate_plan?: string;
	estimated_amount?: number;
	[key: string]: unknown;
};

export type AvailabilityResult = {
	property: string;
	offers: AvailabilityOffer[];
};

export type ReservationRow = {
	reservation: string;
	status: string;
	guest: string;
	arrival_date: string | null;
	departure_date: string | null;
	room_type: string | null;
	total_estimated_amount: number | null;
	currency: string | null;
};

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

async function call<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
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
		const msg = (parsed as { exception?: string } | undefined)?.exception ?? `${path} failed with ${response.status}`;
		throw new FolioApiError(msg, { status: response.status });
	}
	const data = (parsed as { message?: T } | undefined)?.message;
	if (data === undefined) throw new FolioApiError(`${path} returned an unexpected body`, { status: response.status });
	return data;
}

export async function listReservations(): Promise<{ reservations: ReservationRow[] }> {
	return call("the_reezort.reservation.api.list_reservations", "GET");
}

export async function searchAvailability(
	arrivalDate: string,
	departureDate: string,
	adults: number
): Promise<AvailabilityResult> {
	return call("the_reezort.reservation.api.search_availability", "POST", {
		arrival_date: arrivalDate,
		departure_date: departureDate,
		rooms: [{ adults, children: 0 }],
	});
}

export async function createHold(
	property: string,
	arrivalDate: string,
	departureDate: string,
	roomType: string,
	adults: number
): Promise<{ reservation: string; status: string; hold_expires_at: string }> {
	return call("the_reezort.reservation.api.create_quote_or_hold", "POST", {
		property,
		arrival_date: arrivalDate,
		departure_date: departureDate,
		rooms: [{ room_type: roomType, adults, children: 0 }],
		source: "Staff",
	});
}

export async function confirmReservation(
	reservation: string,
	booker: { full_name: string; email?: string; phone?: string }
): Promise<{ reservation: string; status: string; confirmation_number: string }> {
	return call("the_reezort.reservation.api.confirm_reservation", "POST", {
		reservation,
		booker,
		accepted_terms: true,
	});
}

export async function cancelReservation(reservation: string, reason = "Guest Request"): Promise<{ status: string }> {
	return call("the_reezort.reservation.api.cancel_reservation", "POST", { reservation, reason });
}
