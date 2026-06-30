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
