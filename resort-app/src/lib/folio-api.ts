/**
 * Folio billing API client for the_reezort.billing.* whitelisted methods.
 *
 * Mirrors the live-with-mock-fallback pattern in resort-api.ts:
 *   - raw fetch with credentials: "include"
 *   - throws on non-2xx, non-ok envelope, or empty body
 *   - returns the unwrapped data block on success
 *
 * Common envelope: { ok, data, warnings, blockers, next_actions }
 * Validation failures may also surface as frappe.throw HTML pages (per
 * contracts/api.md house style) — those manifest as non-2xx and are
 * surfaced verbatim via FolioApiError.
 */

export type FolioApiEnvelope<T> = {
	ok: boolean;
	data?: T;
	warnings?: FolioMessage[];
	blockers?: FolioMessage[];
	next_actions?: string[];
};

export type FolioMessage = {
	code: string;
	message: string;
};

export class FolioApiError extends Error {
	readonly status: number;
	readonly blockers: FolioMessage[];
	readonly warnings: FolioMessage[];
	readonly rawEnvelope?: FolioApiEnvelope<unknown>;

	constructor(
		message: string,
		options: {
			status: number;
			blockers?: FolioMessage[];
			warnings?: FolioMessage[];
			rawEnvelope?: FolioApiEnvelope<unknown>;
		}
	) {
		super(message);
		this.name = "FolioApiError";
		this.status = options.status;
		this.blockers = options.blockers ?? [];
		this.warnings = options.warnings ?? [];
		this.rawEnvelope = options.rawEnvelope;
	}
}

// ---------- Domain types ----------

export type FolioStatus =
	| "Draft"
	| "Open"
	| "Under Review"
	| "Ready for Settlement"
	| "Settled"
	| "Closed"
	| "Cancelled"
	| "Transferred";

export type PostingStatus =
	| "Not Posted"
	| "Partially Posted"
	| "Posted"
	| "Failed"
	| "Reversed";

export type BalanceStatus =
	| "No Balance"
	| "Outstanding"
	| "Credit Balance"
	| "Settled"
	| "Disputed";

export type FolioType =
	| "Guest"
	| "Company"
	| "Travel Agent"
	| "Group Master"
	| "Incidentals"
	| "Complimentary"
	| "Direct";

export type LineType =
	| "Charge"
	| "Tax Preview"
	| "Discount"
	| "Adjustment"
	| "Deposit Application"
	| "Payment Reference"
	| "Refund"
	| "Write-Off"
	| "Transfer";

export type LineStatus =
	| "Draft"
	| "Open"
	| "Routed"
	| "Voided"
	| "Posted"
	| "Credited"
	| "Refunded"
	| "Written Off"
	| "Transferred";

export type TaxTreatment =
	| "Standard"
	| "Exempt"
	| "Zero Rated"
	| "Inclusive"
	| "Manual Review";

export type SourceModule =
	| "PMS"
	| "Room"
	| "Restaurant"
	| "Spa"
	| "Event"
	| "Minibar"
	| "Transport"
	| "Manual"
	| "Integration";

export type GuestFolioHeader = {
	name: string;
	resort_property: string;
	company: string;
	stay?: string | null;
	reservation?: string | null;
	customer: string;
	customer_name?: string | null;
	guest_name?: string | null;
	guest_image?: string | null;
	room_number?: string | null;
	folio_type: FolioType;
	primary_folio?: 0 | 1;
	folio_status: FolioStatus;
	currency: string;
	billing_instruction?: string | null;
	credit_allowed?: 0 | 1;
	closed_by?: string | null;
	closed_at?: string | null;
};

export type FolioLine = {
	name: string;
	guest_folio: string;
	line_type: LineType;
	source_module: SourceModule;
	source_doctype?: string | null;
	source_name?: string | null;
	source_row_id?: string | null;
	idempotency_key: string;
	service_date: string; // YYYY-MM-DD
	department?: string | null;
	cost_center?: string | null;
	item_code?: string | null;
	description: string;
	qty: number;
	rate: number;
	amount: number;
	tax_treatment: TaxTreatment;
	discount_amount?: number | null;
	approval?: string | null;
	line_status: LineStatus;
	// erpnext_* fields are masked to null for non-finance roles (server-side)
	erpnext_sales_invoice?: string | null;
	erpnext_payment_entry?: string | null;
	erpnext_credit_note?: string | null;
	erpnext_journal_entry?: string | null;
	creation?: string;
};

export type FolioTotals = {
	total_charges: number;
	total_discounts: number;
	total_taxes_estimated: number;
	total_paid: number;
	outstanding_amount: number;
};

export type FolioDetail = {
	folio: GuestFolioHeader;
	lines: FolioLine[];
	totals?: FolioTotals;
	balance_status?: BalanceStatus;
	posting_status?: PostingStatus;
	next_actions?: string[];
};

// ---------- Add-Line payload ----------

export type AddLinePayload = {
	line_type: "Charge" | "Discount" | "Adjustment";
	source_module: SourceModule;
	idempotency_key: string;
	service_date: string;
	department?: string | null;
	item_code?: string | null;
	description: string;
	qty: number;
	rate: number;
	amount: number;
	tax_treatment: TaxTreatment;
	discount_amount?: number;
};

// ---------- Settle payload (F4) ----------

export type SettlementPaymentKind =
	| "Cash"
	| "Card"
	| "UPI"
	| "Bank Transfer"
	| "Gateway"
	| "Deposit Application"
	| "Corporate Credit"
	| "Write-Off"
	| "Complimentary";

export type SettlementPaymentInput = {
	payment_kind: SettlementPaymentKind;
	amount: number;
	payment_mode?: string | null;
	reference_no?: string | null;
};

export type SettleFolioResult = {
	folio_settlement?: string;
	sales_invoice?: string;
	payment_entry?: string;
	posting_status?: PostingStatus;
	[k: string]: unknown;
};

// ---------- Low-level helpers ----------

const BASE = "/api/method";

async function callBilling<T>(
	path: string,
	init: { method: "GET"; params: Record<string, string | undefined> } | {
		method: "POST";
		body: Record<string, unknown>;
	}
): Promise<FolioApiEnvelope<T>> {
	const url = init.method === "GET" ? `${BASE}/${path}?${toQuery(init.params)}` : `${BASE}/${path}`;
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
		throw new FolioApiError(
			`Billing ${path} failed with ${response.status}`,
			{
				status: response.status,
				blockers: extractMessages(parsed, "blockers"),
				warnings: extractMessages(parsed, "warnings"),
				rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
			}
		);
	}

	const envelope = unwrapFrappeMessage<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object") {
		throw new FolioApiError(`Billing ${path} returned an empty body`, {
			status: response.status,
		});
	}

	return envelope;
}

function toQuery(params: Record<string, string | undefined>): string {
	const search = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== "") search.set(k, v);
	}
	return search.toString();
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Frappe's whitelisted JSON endpoints return either:
 *   { message: <envelope> }       — typical
 *   { message: { ... }, exc: ... } — frappe.throw failures
 *   <envelope>                     — direct (some setups)
 *
 * We accept all three shapes.
 */
function unwrapFrappeMessage<T>(parsed: unknown): T | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const obj = parsed as Record<string, unknown>;
	if ("message" in obj) {
		return obj.message as T;
	}
	return parsed as T;
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	const envelope = unwrapFrappeMessage<FolioApiEnvelope<unknown>>(parsed);
	if (envelope && Array.isArray(envelope[key])) {
		return envelope[key] as FolioMessage[];
	}
	return [];
}

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	return w.csrf_token ?? w.frappe?.csrf_token ?? "";
}

// ---------- Public endpoints ----------

/**
 * Creates or returns the primary folio for a reservation or active stay.
 * Idempotent — one primary folio per reservation/stay.
 */
export async function getOrCreateFolio(input: {
	reservation?: string;
	stay?: string;
	customer?: string;
	folio_type?: FolioType;
}): Promise<FolioApiEnvelope<{ folio: GuestFolioHeader }>> {
	return callBilling<{ folio: GuestFolioHeader }>(
		"the_reezort.billing.api.get_or_create_folio",
		{
			method: "GET",
			params: {
				reservation: input.reservation,
				stay: input.stay,
				customer: input.customer,
				folio_type: input.folio_type ?? "Guest",
			},
		}
	);
}

/**
 * Returns the full folio detail bundle for one Guest Folio.
 * v1 envelope.data: { folio, lines, totals, balance_status, posting_status, next_actions }
 * Forward-looking blocks (deposit_summary, settlement_summary, erpnext_links,
 * approval_history) are absent in F2 v1 and surface as undefined — UI degrades
 * gracefully per spec §7.6.
 */
export async function getFolioDetail(
	guestFolio: string
): Promise<FolioApiEnvelope<FolioDetail>> {
	return callBilling<FolioDetail>(
		"the_reezort.billing.api.get_folio_detail",
		{ method: "GET", params: { guest_folio: guestFolio } }
	);
}

/**
 * Adds a manual Folio Line (Charge / Discount / Adjustment).
 * idempotency_key MUST be stable across retries — the SPA generates it once
 * per Add-Line sheet open and reuses it on submit retries to avoid duplicates.
 */
export async function addFolioLine(
	guestFolio: string,
	payload: AddLinePayload
): Promise<FolioApiEnvelope<FolioLine>> {
	return callBilling<FolioLine>(
		"the_reezort.billing.api.add_folio_line",
		{ method: "POST", body: { guest_folio: guestFolio, payload } }
	);
}

/**
 * F4: posts the folio to ERPNext — creates submitted Sales Invoice +
 * Payment Entry. Idempotent on the supplied key (or server-generated key
 * if absent). Returns the created/linked document names.
 *
 * v1 next_actions does not emit "open_settlement" yet, so this endpoint
 * is wired but the UI trigger remains gated on backend next_actions per
 * the hide-don't-disable rule.
 */
export async function settleFolio(input: {
	guest_folio: string;
	payments?: SettlementPaymentInput[];
	idempotency_key?: string;
}): Promise<FolioApiEnvelope<SettleFolioResult>> {
	return callBilling<SettleFolioResult>(
		"the_reezort.billing.settlement.settle_folio",
		{
			method: "POST",
			body: {
				guest_folio: input.guest_folio,
				payments: input.payments ?? [],
				idempotency_key: input.idempotency_key,
			},
		}
	);
}

export type DepositResult = {
	guest_folio: string;
	folio_line: string;
	payment_entry: string | null;
	outstanding: number;
	total_paid: number;
	reused: boolean;
};

export async function recordDeposit(input: {
	guest_folio: string;
	amount: number;
	mode_of_payment: string;
	reference_no?: string;
	idempotency_key?: string;
}): Promise<FolioApiEnvelope<DepositResult>> {
	return callBilling<DepositResult>("the_reezort.billing.deposits.record_deposit", {
		method: "POST",
		body: {
			guest_folio: input.guest_folio,
			amount: input.amount,
			mode_of_payment: input.mode_of_payment,
			reference_no: input.reference_no,
			idempotency_key: input.idempotency_key,
		},
	});
}

// ---------- Razorpay (card/UPI) ----------

import { openRazorpayCheckout, type RazorpayOrder, type RazorpayPaymentResult } from "@/lib/razorpay";

export async function createRazorpayDepositOrder(input: {
	guest_folio: string;
	amount: number;
}): Promise<RazorpayOrder> {
	const env = await callBilling<RazorpayOrder>("the_reezort.billing.razorpay_gateway.create_deposit_order", {
		method: "POST",
		body: { guest_folio: input.guest_folio, amount: input.amount },
	});
	if (!env.data) throw new FolioApiError("Razorpay order returned no data", { status: 500 });
	return env.data;
}

export async function createRazorpaySettleOrder(guest_folio: string): Promise<RazorpayOrder> {
	const env = await callBilling<RazorpayOrder>("the_reezort.billing.razorpay_gateway.create_order", {
		method: "POST",
		body: { guest_folio },
	});
	if (!env.data) throw new FolioApiError("Razorpay order returned no data", { status: 500 });
	return env.data;
}

export async function captureRazorpayDeposit(input: {
	guest_folio: string;
	payment: RazorpayPaymentResult;
}): Promise<FolioApiEnvelope<DepositResult>> {
	return callBilling<DepositResult>("the_reezort.billing.razorpay_gateway.capture_deposit", {
		method: "POST",
		body: {
			guest_folio: input.guest_folio,
			razorpay_order_id: input.payment.order_id,
			razorpay_payment_id: input.payment.payment_id,
			razorpay_signature: input.payment.signature,
			amount: input.payment.amount / 100,
		},
	});
}

export async function captureRazorpaySettlement(input: {
	guest_folio: string;
	payment: RazorpayPaymentResult;
}): Promise<FolioApiEnvelope<SettleFolioResult>> {
	return callBilling<SettleFolioResult>("the_reezort.billing.razorpay_gateway.capture_payment", {
		method: "POST",
		body: {
			guest_folio: input.guest_folio,
			razorpay_order_id: input.payment.order_id,
			razorpay_payment_id: input.payment.payment_id,
			razorpay_signature: input.payment.signature,
			amount: input.payment.amount / 100,
		},
	});
}

/**
 * Orchestrates a deposit via Razorpay: create order → open modal → capture.
 * Returns the deposit envelope (with the real Payment Entry id).
 */
export async function payDepositViaRazorpay(input: {
	guest_folio: string;
	amount: number;
	guestName?: string;
	guestEmail?: string | null;
	guestPhone?: string | null;
}): Promise<FolioApiEnvelope<DepositResult>> {
	const order = await createRazorpayDepositOrder({ guest_folio: input.guest_folio, amount: input.amount });
	const payment = await openRazorpayCheckout({
		order,
		guestName: input.guestName,
		guestEmail: input.guestEmail,
		guestPhone: input.guestPhone,
		description: `Deposit · ${input.guest_folio}`,
	});
	return captureRazorpayDeposit({ guest_folio: input.guest_folio, payment });
}

/**
 * Orchestrates settlement via Razorpay: create order → open modal → capture.
 * Returns the settlement envelope (Sales Invoice + Payment Entry created).
 */
export async function paySettlementViaRazorpay(input: {
	guest_folio: string;
	guestName?: string;
	guestEmail?: string | null;
	guestPhone?: string | null;
}): Promise<FolioApiEnvelope<SettleFolioResult>> {
	const order = await createRazorpaySettleOrder(input.guest_folio);
	const payment = await openRazorpayCheckout({
		order,
		guestName: input.guestName,
		guestEmail: input.guestEmail,
		guestPhone: input.guestPhone,
		description: `Folio settlement · ${input.guest_folio}`,
	});
	return captureRazorpaySettlement({ guest_folio: input.guest_folio, payment });
}

// ---------- Utility ----------

/**
 * Stable manual-line idempotency key.
 * Format: manual:<folio>:<uuid> — the folio name pins the scope, the UUID
 * pins this specific Add-Line attempt across submit retries.
 */
export function makeManualLineIdempotencyKey(folio: string): string {
	const uuid =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	return `manual:${folio}:${uuid}`;
}

/**
 * Stable settlement idempotency key.
 * Format: settle:<folio>:<uuid> — same scoping rule as manual lines.
 */
export function makeSettlementIdempotencyKey(folio: string): string {
	const uuid =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	return `settle:${folio}:${uuid}`;
}
