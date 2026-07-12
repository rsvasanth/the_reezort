/**
 * CRM / Guest-360 / Loyalty / Feedback API client.
 * Module 012 — backs GuestList, Guest360, and related quick-action panels.
 *
 * Backend: the_reezort.crm.api.* / the_reezort.crm.loyalty.* / the_reezort.crm.feedback.*
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

// ─────────────────────────────────────────────────────────────────────────────
// Domain unions — mirrors of doctype Select fields
// ─────────────────────────────────────────────────────────────────────────────

/** Mirror of Guest Profile.status */
export type GuestProfileStatus =
	| "Active"
	| "Duplicate Review"
	| "Merged"
	| "Restricted"
	| "Anonymized"
	| "Inactive";

/** Mirror of Guest Profile.vip_level */
export type VipLevel =
	| "Standard"
	| "None"
	| "VIP"
	| "VVIP"
	| "Owner"
	| "Corporate"
	| "Special Attention"
	| "Blacklisted";

/** Mirror of Guest Profile.privacy_level */
export type PrivacyLevel = "Normal" | "Private" | "Security" | "Executive";

/** Mirror of Guest Profile.guest_type */
export type GuestType =
	| "Individual"
	| "Corporate Guest"
	| "Event Guest"
	| "Travel Agent Guest"
	| "Owner Guest";

/** Mirror of Guest Preference.preference_type */
export type PreferenceType =
	| "Room"
	| "Pillow"
	| "Food"
	| "Allergy"
	| "Accessibility"
	| "Communication"
	| "Occasion"
	| "Other";

/** Mirror of Guest Preference.sensitivity */
export type PreferenceSensitivity = "Normal" | "Allergy" | "Medical" | "Accessibility" | "Private";

/** Mirror of Guest Preference.source */
export type PreferenceSource = "Guest" | "Staff" | "Stay" | "Feedback" | "Import";

/** Mirror of Guest Consent.purpose */
export type ConsentPurpose =
	| "Marketing"
	| "Feedback"
	| "Profiling"
	| "Third Party Sharing"
	| "Loyalty"
	| "Transactional";

/** Mirror of Guest Consent.channel */
export type ConsentChannel =
	| "Email"
	| "SMS"
	| "WhatsApp"
	| "Phone"
	| "Postal"
	| "App"
	| "Any";

/** Mirror of Guest Consent.status */
export type ConsentStatus = "Granted" | "Withdrawn" | "Expired" | "Unknown";

/** Mirror of Guest Consent.source */
export type ConsentSource =
	| "Website"
	| "Reservation"
	| "Check In"
	| "Staff"
	| "Import"
	| "Campaign"
	| "Guest Portal";

/** Mirror of Resort Loyalty Program.status */
export type LoyaltyProgramStatus = "Draft" | "Active" | "Suspended" | "Closed";

/** Mirror of Resort Loyalty Program.accrual_basis */
export type AccrualBasis = "Spend" | "Nights" | "Stay Count" | "Manual" | "Hybrid";

/** Mirror of Resort Loyalty Program.redemption_basis */
export type RedemptionBasis = "Points" | "Value" | "Voucher" | "Tier Benefit";

/** Mirror of Loyalty Membership.status */
export type MembershipStatus = "Active" | "Suspended" | "Closed" | "Expired";

/** Mirror of Loyalty Transaction.transaction_type */
export type TransactionType = "Accrual" | "Redemption" | "Adjustment" | "Expiry" | "Reversal";

/** Mirror of Loyalty Transaction.status */
export type TransactionStatus = "Draft" | "Approved" | "Posted" | "Reversed" | "Cancelled";

/** Mirror of Guest Feedback.context */
export type FeedbackContext =
	| "Stay"
	| "Post Stay"
	| "F&B"
	| "Event"
	| "Guest Service"
	| "Maintenance"
	| "General";

/** Mirror of Guest Feedback.status */
export type FeedbackStatus =
	| "New"
	| "Reviewed"
	| "Follow Up Required"
	| "Linked to Complaint"
	| "Responded"
	| "Closed";

/** Mirror of Guest Feedback.sentiment */
export type FeedbackSentiment = "Positive" | "Neutral" | "Negative" | "Mixed";

// ─────────────────────────────────────────────────────────────────────────────
// Shape types
// ─────────────────────────────────────────────────────────────────────────────

export type GuestPreference = {
	name: string;
	preference_type: PreferenceType;
	preference_value: string;
	sensitivity: PreferenceSensitivity;
	source: PreferenceSource | null;
	verified: number;
	is_active: number;
	notes: string | null;
};

export type GuestConsent = {
	name: string;
	purpose: ConsentPurpose;
	channel: ConsentChannel;
	status: ConsentStatus;
	source: ConsentSource | null;
	captured_at: string;
	expires_at: string | null;
	evidence_reference: string | null;
};

export type LoyaltyMembershipSummary = {
	name: string;
	loyalty_program: string;
	membership_number: string;
	tier: string | null;
	points_balance: number;
	value_balance: number;
	status: MembershipStatus;
};

export type LoyaltyTransaction = {
	name: string;
	transaction_type: TransactionType;
	status: TransactionStatus;
	points: number;
	value_amount: number;
	reason: string | null;
	creation: string;
};

export type GuestFeedbackItem = {
	name: string;
	context: FeedbackContext;
	status: FeedbackStatus;
	nps_score: number | null;
	rating: number | null;
	sentiment: FeedbackSentiment | null;
	comments: string | null;
	submitted_at: string;
};

export type Guest360 = {
	guest_profile: string;
	full_name: string;
	status: GuestProfileStatus;
	vip_level: VipLevel | null;
	privacy_level: PrivacyLevel | null;
	guest_type: GuestType | null;
	do_not_contact: boolean;
	primary_email: string | null;
	primary_phone: string | null;
	preferred_language: string | null;
	nationality: string | null;
	last_stay_date: string | null;
	lifetime_stays: number;
	lifetime_revenue: number;
	erpnext_customer: string | null;
	stays: unknown[];
	reservations: unknown[];
	folios: unknown[];
	requests: unknown[];
	complaints: unknown[];
	feedback: GuestFeedbackItem[];
	loyalty: LoyaltyMembershipSummary | null;
	loyalty_transactions: LoyaltyTransaction[];
	preferences: GuestPreference[];
	consents: GuestConsent[];
};

export type GuestProfileListItem = {
	name: string;
	full_name: string;
	primary_email: string | null;
	primary_phone: string | null;
	status: GuestProfileStatus;
	vip_level: VipLevel | null;
	do_not_contact: boolean;
	lifetime_stays: number;
	last_stay_date: string | null;
};

export type GuestProfileListResult = {
	guests: GuestProfileListItem[];
	total_count: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Transport helpers
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

function safeJson(text: string): unknown {
	try { return JSON.parse(text); } catch { return undefined; }
}

function unwrap<T>(parsed: unknown): T | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const obj = parsed as Record<string, unknown>;
	return ("message" in obj ? (obj.message as T) : (parsed as T));
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	const env = unwrap<FolioApiEnvelope<unknown>>(parsed);
	const list = env && (env as Record<string, unknown>)[key];
	return Array.isArray(list) ? (list as FolioMessage[]) : [];
}

function toQuery(params: Record<string, string | undefined>): string {
	const s = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== "") s.set(k, v);
	}
	return s.toString();
}

async function callCrm<T>(
	path: string,
	init:
		| { method: "GET"; params: Record<string, string | undefined> }
		| { method: "POST"; body: Record<string, unknown> }
): Promise<T> {
	const url =
		init.method === "GET"
			? `${BASE}/${path}?${toQuery(init.params)}`
			: `${BASE}/${path}`;

	const response = await fetch(url, {
		method: init.method,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
	});

	const text = await response.text();
	const parsed = text ? safeJson(text) : undefined;

	if (!response.ok) {
		throw new FolioApiError(`CRM ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`CRM ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────────────────

export async function getGuest360(
	guestProfile: string,
	includeSensitive = false
): Promise<Guest360> {
	return callCrm<Guest360>("the_reezort.crm.api.get_guest_360", {
		method: "GET",
		params: {
			guest_profile: guestProfile,
			include_sensitive: includeSensitive ? "1" : "0",
		},
	});
}

export async function createOrUpdateGuestProfile(payload: {
	full_name: string;
	email?: string;
	phone?: string;
	source?: string;
	vip_level?: VipLevel;
	guest_type?: GuestType;
	nationality?: string;
	preferred_language?: string;
}): Promise<{ guest_profile: string; status: GuestProfileStatus; duplicate_candidates: string[] }> {
	return callCrm("the_reezort.crm.api.create_or_update_guest_profile", {
		method: "POST",
		body: {
			full_name: payload.full_name,
			email: payload.email ?? "",
			phone: payload.phone ?? "",
			source: payload.source ?? "Staff",
			...payload,
		},
	});
}

export async function recordGuestConsent(payload: {
	guest_profile: string;
	purpose: ConsentPurpose;
	channel: ConsentChannel;
	status: ConsentStatus;
	source: ConsentSource;
	evidence_reference?: string;
	expires_at?: string;
}): Promise<{ guest_consent: string; status: ConsentStatus }> {
	return callCrm("the_reezort.crm.api.record_guest_consent", {
		method: "POST",
		body: payload,
	});
}

export async function updateGuestPreference(payload: {
	guest_profile: string;
	preference_type: PreferenceType;
	preference_value: string;
	sensitivity?: PreferenceSensitivity;
	source?: PreferenceSource;
	notes?: string;
}): Promise<{ guest_preference: string; is_active: boolean }> {
	return callCrm("the_reezort.crm.api.update_guest_preference", {
		method: "POST",
		body: payload,
	});
}

export async function enrollLoyaltyMember(payload: {
	guest_profile: string;
	loyalty_program?: string;
}): Promise<{ loyalty_membership: string; status: MembershipStatus; tier: string | null }> {
	return callCrm("the_reezort.crm.loyalty.enroll_loyalty_member", {
		method: "POST",
		body: payload,
	});
}

export async function postLoyaltyTransaction(payload: {
	loyalty_membership: string;
	transaction_type: TransactionType;
	points?: number;
	value_amount?: number;
	reason?: string;
	guest_folio?: string;
}): Promise<{ loyalty_transaction: string; status: TransactionStatus; points_balance: number }> {
	return callCrm("the_reezort.crm.loyalty.post_loyalty_transaction", {
		method: "POST",
		body: payload,
	});
}

export async function listLoyaltyTransactions(params: {
	loyalty_membership: string;
	limit?: number;
	offset?: number;
}): Promise<{ transactions: LoyaltyTransaction[]; total_count: number }> {
	return callCrm("the_reezort.crm.loyalty.list_loyalty_transactions", {
		method: "GET",
		params: {
			loyalty_membership: params.loyalty_membership,
			limit_page_length: params.limit !== undefined ? String(params.limit) : undefined,
			limit_start: params.offset !== undefined ? String(params.offset) : undefined,
		},
	});
}

export async function getMembership(
	guestProfile: string
): Promise<LoyaltyMembershipSummary | null> {
	return callCrm("the_reezort.crm.loyalty.get_membership", {
		method: "GET",
		params: { guest_profile: guestProfile },
	});
}

export async function submitFeedback(payload: {
	guest_profile?: string;
	reservation?: string;
	stay?: string;
	context?: FeedbackContext;
	nps_score?: number;
	rating?: number;
	sentiment?: FeedbackSentiment;
	comments?: string;
}): Promise<{
	guest_feedback: string;
	status: FeedbackStatus;
	follow_up_required: boolean;
	guest_complaint: string | null;
}> {
	return callCrm("the_reezort.crm.feedback.submit_feedback", {
		method: "POST",
		body: payload,
	});
}

export async function listFeedback(params: {
	guest_profile?: string;
	status?: FeedbackStatus;
	limit?: number;
	offset?: number;
}): Promise<{ feedback: GuestFeedbackItem[]; total_count: number }> {
	return callCrm("the_reezort.crm.feedback.list_feedback", {
		method: "GET",
		params: {
			guest_profile: params.guest_profile,
			status: params.status,
			limit_page_length: params.limit !== undefined ? String(params.limit) : undefined,
			limit_start: params.offset !== undefined ? String(params.offset) : undefined,
		},
	});
}

export async function listGuestProfiles(params: {
	search?: string;
	status?: GuestProfileStatus;
	vip_level?: VipLevel;
	limit?: number;
	offset?: number;
}): Promise<GuestProfileListResult> {
	return callCrm("the_reezort.crm.api.list_guest_profiles", {
		method: "GET",
		params: {
			search: params.search,
			status: params.status,
			vip_level: params.vip_level,
			limit_page_length: params.limit !== undefined ? String(params.limit) : undefined,
			limit_start: params.offset !== undefined ? String(params.offset) : undefined,
		},
	});
}
