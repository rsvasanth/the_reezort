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
	room_type_image: string | null;
	nights: number | null;
	due_today: boolean;
};

export type FrontDeskInHouse = {
	stay: string;
	guest: string;
	room: string | null;
	room_image: string | null;
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

// ---------- full check-in process (003) ----------

export type IdType = "Aadhaar" | "Passport" | "Driving License" | "Voter ID" | "PAN Card" | "Other";
export type PurposeOfVisit = "Leisure" | "Business" | "Event" | "Honeymoon" | "Other";

export type CheckInGuest = {
	name: string;
	guest_full_name: string | null;
	email: string | null;
	phone: string | null;
	image: string | null;
	date_of_birth: string | null;
	nationality: string | null;
	address: string | null;
	id_type: IdType | null;
	id_number: string | null;
	id_expiry: string | null;
	id_document: string | null;
	id_name: string | null;
	kyc_verified: number;
	kyc_verified_by: string | null;
	kyc_verified_at: string | null;
	name_match_score: number | null;
	kyc_override_reason: string | null;
};

export type NameMatchStatus = "match" | "review" | "mismatch";

export type NameMatch = {
	id_name: string | null;
	reservation_name: string;
	score: number;
	status: NameMatchStatus;
};

export type CheckInRoomOption = {
	name: string;
	room_number: string;
	room_name: string | null;
	housekeeping_status: string | null;
};

export type RegistrationCard = {
	name: string;
	reservation: string;
	stay: string | null;
	guest_profile: string | null;
	guest_full_name: string | null;
	id_type: string | null;
	id_number: string | null;
	nationality: string | null;
	date_of_birth: string | null;
	address: string | null;
	purpose_of_visit: PurposeOfVisit | null;
	arrival_from: string | null;
	vehicle_number: string | null;
	expected_departure: string | null;
	adults: number | null;
	children: number | null;
	terms_accepted: number;
	signature: string | null;
	signed_at: string | null;
	registered_by: string | null;
	is_signed: boolean;
};

export type CheckInReadiness = {
	kyc: boolean;
	registration: boolean;
	room_selected: boolean;
	photos: boolean;
	deposit: boolean;
	can_finalize: boolean;
};

export type CheckInDeposit = {
	name: string;
	total_paid: number;
	outstanding_amount: number;
	total_charges: number;
	folio_status: string;
	deposits: { name: string; amount: number; description: string | null; erpnext_payment_entry: string | null; service_date: string | null }[];
	deposit_total: number;
};

export type CheckInContext = {
	reservation: string;
	status: string;
	resort_property: string;
	room_type: string | null;
	room_type_name: string | null;
	arrival_date: string | null;
	departure_date: string | null;
	nights: number | null;
	guest_profile: string | null;
	guest: CheckInGuest | null;
	available_rooms: CheckInRoomOption[];
	registration_card: RegistrationCard | null;
	folio: string | null;
	deposit: CheckInDeposit | null;
	condition_capture: { check_in_done: boolean; count: number };
	stay: { name: string; current_room: string | null; stay_status: string } | null;
	name_match: NameMatch;
	readiness: CheckInReadiness;
};

export type KycInput = {
	date_of_birth?: string;
	nationality?: string;
	address?: string;
	id_type?: IdType;
	id_number?: string;
	id_expiry?: string;
	id_document?: string;
	id_name?: string;
};

export type RegistrationCardInput = {
	guest_full_name?: string;
	id_type?: string;
	id_number?: string;
	nationality?: string;
	date_of_birth?: string;
	address?: string;
	purpose_of_visit?: PurposeOfVisit;
	arrival_from?: string;
	vehicle_number?: string;
	expected_departure?: string;
	adults?: number;
	children?: number;
	signature?: string;
	terms_accepted?: boolean;
};

export async function getCheckInContext(reservation: string): Promise<CheckInContext> {
	return pmsCall<CheckInContext>("the_reezort.pms.api.get_check_in_context", "GET", { reservation });
}

export async function saveGuestKyc(
	reservation: string,
	kyc: KycInput,
	verify: boolean,
	overrideReason?: string
): Promise<{ guest_profile: string; guest: CheckInGuest; name_match: NameMatch }> {
	return pmsCall("the_reezort.pms.api.save_guest_kyc", "POST", {
		reservation,
		kyc,
		verify: verify ? 1 : 0,
		override_reason: overrideReason,
	});
}

export async function saveRegistrationCard(
	reservation: string,
	card: RegistrationCardInput
): Promise<{ registration_card: RegistrationCard }> {
	return pmsCall("the_reezort.pms.api.save_registration_card", "POST", { reservation, card });
}

export async function finalizeCheckIn(input: {
	reservation: string;
	room?: string;
	arrival_time?: string;
}): Promise<CheckInResult & { registration_card: string | null }> {
	return pmsCall("the_reezort.pms.api.finalize_check_in", "POST", {
		reservation: input.reservation,
		room: input.room,
		arrival_time: input.arrival_time,
	});
}

// ---------- room move (in-house room switch) ----------

export type RoomMoveReason = "Maintenance" | "Guest Request" | "Upgrade" | "Downgrade" | "Overbooking" | "Other";

export type RoomMoveResult = {
	move: string;
	stay: string;
	from_room: string;
	to_room: string;
	source_out_of_order: boolean;
	maintenance_task: string | null;
	target_room_number: string;
	target_room_name: string | null;
};

export type VacantRoom = {
	name: string;
	room_number: string;
	room_name: string | null;
	room_type: string;
	housekeeping_status: string;
};

export async function listVacantRoomsForMove(stay: string): Promise<{ rooms: VacantRoom[] }> {
	return pmsCall("the_reezort.pms.api.list_vacant_rooms_for_move", "GET", { stay });
}

export async function moveGuestRoom(input: {
	stay: string;
	to_room: string;
	reason: RoomMoveReason;
	notes?: string;
	source_out_of_order?: boolean;
}): Promise<RoomMoveResult> {
	return pmsCall("the_reezort.pms.api.move_guest_room", "POST", {
		stay: input.stay,
		to_room: input.to_room,
		reason: input.reason,
		notes: input.notes,
		source_out_of_order: input.source_out_of_order ? 1 : 0,
	});
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

// ---------- late checkout ----------

export type LateCheckoutRequestStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";
export type LateCheckoutChargePolicy = "No Charge" | "Half Day" | "Full Day" | "Custom";

export type LateCheckoutRequest = {
	name: string;
	stay: string;
	guest_name: string;
	room: string | null;
	requested_checkout_time: string;
	request_status: LateCheckoutRequestStatus;
	charge_policy: LateCheckoutChargePolicy | null;
	affects_incoming: boolean;
	requested_at: string | null;
};

export async function requestLateCheckout(
	stay: string,
	requestedCheckoutTime: string,
	reason?: string
): Promise<{ late_checkout_request: string; reused: boolean; affects_incoming: boolean }> {
	return pmsCall("the_reezort.pms.lifecycle.request_late_checkout", "POST", {
		stay,
		requested_checkout_time: requestedCheckoutTime,
		reason,
	});
}

export async function approveLateCheckout(
	lateCheckoutRequest: string,
	approve: boolean,
	chargePolicy?: LateCheckoutChargePolicy,
	rejectionReason?: string
): Promise<{ late_checkout_request: string; request_status: string; charge_policy: string | null }> {
	return pmsCall("the_reezort.pms.lifecycle.approve_late_checkout", "POST", {
		late_checkout_request: lateCheckoutRequest,
		approve: approve ? 1 : 0,
		charge_policy: chargePolicy,
		rejection_reason: rejectionReason,
	});
}

export async function listLateCheckoutRequests(
	resortProperty?: string,
	status?: LateCheckoutRequestStatus
): Promise<{ requests: LateCheckoutRequest[] }> {
	return pmsCall("the_reezort.pms.lifecycle.list_late_checkout_requests", "GET", {
		resort_property: resortProperty,
		status,
	});
}

// ---------- no-show ----------

export type NoShowEligible = {
	reservation: string;
	guest: string;
	arrival_date: string;
	room_type: string | null;
	allocated_room: string | null;
};

export async function listNoShowEligible(
	resortProperty?: string
): Promise<{ eligible: NoShowEligible[] }> {
	return pmsCall("the_reezort.pms.lifecycle.list_no_show_eligible", "GET", {
		resort_property: resortProperty,
	});
}

export async function markNoShow(
	reservation: string,
	reason: string,
	feeApplicable?: boolean,
	feeAmount?: number
): Promise<{ no_show_record: string; reused: boolean; room_released: string | null }> {
	return pmsCall("the_reezort.pms.lifecycle.mark_no_show", "POST", {
		reservation,
		reason,
		fee_applicable: feeApplicable ? 1 : 0,
		fee_amount: feeAmount,
	});
}

export async function reverseNoShow(
	noShowRecord: string,
	reversalReason: string
): Promise<{ no_show_record: string; no_show_status: string; reservation: string; reservation_status: string }> {
	return pmsCall("the_reezort.pms.lifecycle.reverse_no_show", "POST", {
		no_show_record: noShowRecord,
		reversal_reason: reversalReason,
	});
}

// ---------- checkout readiness ----------

export type CheckoutBlocker = {
	type: string;
	message: string;
	folio?: string;
};

export type CheckoutReadiness = {
	stay: string;
	guest: string;
	room: string | null;
	departure_date: string | null;
	blockers: CheckoutBlocker[];
	warnings: CheckoutBlocker[];
	can_checkout: boolean;
};

export async function getCheckoutReadiness(stay: string): Promise<CheckoutReadiness> {
	return pmsCall("the_reezort.pms.lifecycle.get_checkout_readiness", "GET", { stay });
}

// ---------- early departure ----------

export async function earlyDeparture(
	stay: string,
	newDepartureDate: string,
	reason?: string
): Promise<{ stay: string; new_departure_date: string; original_departure_date: string; nights_shortened: number }> {
	return pmsCall("the_reezort.pms.lifecycle.early_departure", "POST", {
		stay,
		new_departure_date: newDepartureDate,
		reason,
	});
}

// ---------- walk-in check-in ----------

export type WalkInResult = {
	reservation: string;
	guest_profile: string;
	customer: string;
	stay: string;
	stay_status: string;
	folio: string;
	current_room: string | null;
	reused: boolean;
};

export async function walkInCheckIn(input: {
	resort_property: string;
	room_type: string;
	guest_name: string;
	nights?: number;
	adults?: number;
	children?: number;
	room?: string;
	phone?: string;
	email?: string;
}): Promise<WalkInResult> {
	return pmsCall("the_reezort.pms.lifecycle.walk_in_check_in", "POST", input);
}
