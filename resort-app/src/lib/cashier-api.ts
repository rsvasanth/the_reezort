/**
 * Cashier Close client for the_reezort.backoffice.cashier.* methods.
 * Shift reconciliation: open → declare/submit → manager approval.
 */

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	return token === "None" ? "" : token;
}

export class CashierApiError extends Error {
	blockers: string[];
	constructor(message: string, blockers: string[] = []) {
		super(message);
		this.name = "CashierApiError";
		this.blockers = blockers;
	}
}

export type CashierPaymentRow = {
	payment_mode: string;
	expected_amount: number;
	declared_amount: number;
	variance: number;
};

export type CashierClose = {
	name: string;
	company: string;
	close_type: string;
	outlet: string | null;
	cashier_user: string;
	shift_reference: string | null;
	opening_time: string | null;
	closing_time: string | null;
	cash_float: number;
	expected_total: number;
	declared_total: number;
	variance_amount: number;
	variance_reason: string | null;
	close_status: "Open" | "Closing" | "Submitted" | "Approved" | "Rejected" | "Reopened";
	approved_by: string | null;
	variance_threshold: number;
	payments: CashierPaymentRow[];
};

export type CashierCloseSummary = {
	name: string;
	close_type: string;
	cashier_user: string;
	opening_time: string | null;
	closing_time: string | null;
	expected_total: number;
	declared_total: number;
	variance_amount: number;
	close_status: string;
};

type Envelope<T> = { message?: { data?: T; blockers?: string[] } };

async function call<T>(
	path: string,
	init:
		| { method: "GET"; params: Record<string, string | undefined> }
		| { method: "POST"; body: Record<string, unknown> }
): Promise<T> {
	const query =
		init.method === "GET"
			? "?" +
			  new URLSearchParams(
					Object.entries(init.params).filter(([, v]) => v !== undefined && v !== "") as [string, string][]
			  ).toString()
			: "";
	const response = await fetch(`${BASE}/${path}${query}`, {
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
	let parsed: Envelope<T> | undefined;
	try {
		parsed = text ? (JSON.parse(text) as Envelope<T>) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		const blockers = parsed?.message?.blockers ?? [];
		const detail = (parsed as unknown as { exception?: string } | undefined)?.exception;
		throw new CashierApiError(detail || `${path} failed (${response.status})`, blockers);
	}
	const data = parsed?.message?.data;
	if (data === undefined) throw new CashierApiError(`${path} returned an unexpected body`);
	return data;
}

export type CashierContext = {
	company: string;
	close_type: string;
	expected_by_mode: Record<string, number>;
	expected_total: number;
	variance_threshold: number;
};

export function getCashierContext(close_type: string): Promise<CashierContext> {
	return call<CashierContext>("the_reezort.backoffice.cashier.get_cashier_close_context", {
		method: "GET",
		params: { close_type },
	});
}

export function openCashierClose(input: {
	close_type: string;
	cash_float: number;
	outlet?: string;
	shift_reference?: string;
}): Promise<CashierClose> {
	return call<CashierClose>("the_reezort.backoffice.cashier.open_cashier_close", {
		method: "POST",
		body: input,
	});
}

export function getCashierClose(cashier_close: string): Promise<CashierClose> {
	return call<CashierClose>("the_reezort.backoffice.cashier.get_cashier_close", {
		method: "GET",
		params: { cashier_close },
	});
}

export function submitCashierClose(
	cashier_close: string,
	declaration: { payments: { payment_mode: string; declared_amount: number }[]; variance_reason?: string }
): Promise<CashierClose> {
	return call<CashierClose>("the_reezort.backoffice.cashier.submit_cashier_close", {
		method: "POST",
		body: { cashier_close, declaration },
	});
}

export function approveCashierClose(
	cashier_close: string,
	decision: "Approve" | "Reject",
	note: string
): Promise<CashierClose> {
	return call<CashierClose>("the_reezort.backoffice.cashier.approve_cashier_close", {
		method: "POST",
		body: { cashier_close, decision, note },
	});
}

export function listCashierCloses(): Promise<{ closes: CashierCloseSummary[] }> {
	return call<{ closes: CashierCloseSummary[] }>("the_reezort.backoffice.cashier.list_cashier_closes", {
		method: "GET",
		params: {},
	});
}
