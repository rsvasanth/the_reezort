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

export type ReservationDetail = {
	reservation: string;
	status: string;
	guest: string;
	arrival_date: string | null;
	departure_date: string | null;
	nights: number | null;
	deposit_status: string | null;
	total_estimated_amount: number | null;
	currency: string | null;
	resort_property: string;
	booking_source: string | null;
	check_in_ready: boolean;
	stay: string | null;
	rooms: { room_type: string; adults: number; children: number; estimated_amount: number | null; status: string }[];
	guests: { guest_name: string; email: string | null; phone: string | null; is_primary_guest: number }[];
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

export async function getReservation(reservation: string): Promise<ReservationDetail> {
	return call("the_reezort.reservation.api.get_reservation", "GET", { reservation });
}

// ---------- booking deposit gate ----------

export type ReservationDepositState = {
	reservation: string;
	deposit_policy: string;
	deposit_status: string;
	required_percent: number;
	required_amount: number;
	paid_amount: number;
	outstanding_amount: number;
	met: boolean;
	total_estimated_amount: number;
	folio: string | null;
	currency: string;
};

export async function getReservationDepositState(reservation: string): Promise<ReservationDepositState> {
	return call("the_reezort.reservation.api.get_reservation_deposit_state", "GET", { reservation });
}

// ---------- occupancy timeline (Gantt) ----------

export type TimelineRoom = {
	name: string;
	room_number: string;
	room_name: string | null;
	room_type: string;
	occupancy_status: string;
	housekeeping_status: string;
	maintenance_status: string;
	sellable_status: string;
};

export type TimelineReservation = {
	name: string;
	guest: string;
	status: string;
	room: string | null;
	room_type: string | null;
	arrival_date: string;
	departure_date: string;
	nights: number;
};

export type TimelineTask = {
	name: string;
	room: string | null;
	task_type: string;
	task_status: string;
	priority: string;
	start_time: string | null;
	completed_at: string | null;
	due_at: string | null;
	creation: string;
};

export type OccupancyTimeline = {
	start_date: string;
	end_date: string;
	days: string[];
	rooms: TimelineRoom[];
	reservations: TimelineReservation[];
	tasks: TimelineTask[];
	resort_property: string;
};

export async function getOccupancyTimeline(input?: {
	start_date?: string;
	days?: number;
}): Promise<OccupancyTimeline> {
	const params: Record<string, string> = {};
	if (input?.start_date) params.start_date = input.start_date;
	if (input?.days) params.days = String(input.days);
	return call("the_reezort.reservation.api.get_occupancy_timeline", "GET", params);
}

export async function ensureBookingFolio(input: {
	reservation: string;
	booker: { full_name: string; email?: string; phone?: string };
}): Promise<{ reservation: string; folio: string }> {
	return call("the_reezort.reservation.api.ensure_booking_folio", "POST", {
		reservation: input.reservation,
		booker: input.booker,
	});
}

export async function recordBookingDeposit(input: {
	reservation: string;
	booker: { full_name: string; email?: string; phone?: string };
	amount: number;
	mode_of_payment: string;
}): Promise<{ folio: string; state: ReservationDepositState }> {
	return call("the_reezort.reservation.api.record_booking_deposit", "POST", {
		reservation: input.reservation,
		booker: input.booker,
		amount: input.amount,
		mode_of_payment: input.mode_of_payment,
	});
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
