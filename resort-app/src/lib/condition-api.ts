/**
 * Room condition capture API client for the_reezort.pms.* whitelisted methods.
 *
 * PMS endpoints return BARE dicts (not the billing {ok,data,...} envelope).
 * Frappe wraps them as { message: <bare dict> }.  We unwrap that one layer
 * and return the typed payload directly — callers never see the Frappe shell.
 *
 * File upload uses /api/method/upload_file with credentials:"include" + CSRF,
 * exactly like folio-api builds its POST requests.
 */

// ---------- Domain types ----------

export type CaptureStage = "Check-In" | "Check-Out";

export type OverallCondition = "Good" | "Minor Issues" | "Damage Noted";

export type ConditionPhoto = {
	image: string; // file URL returned by upload_file
	caption?: string;
	area?: string;
};

export type ConditionCapture = {
	name: string;
	capture_stage: CaptureStage;
	captured_by: string;
	captured_at: string;
	overall_condition: OverallCondition | null;
	notes: string | null;
	photos: ConditionPhoto[];
};

export type CaptureRoomConditionResult = {
	capture: ConditionCapture;
	reused: boolean;
};

export type GetRoomConditionCapturesResult = {
	captures: ConditionCapture[];
};

// ---------- Error ----------

export class ConditionApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "ConditionApiError";
		this.status = status;
	}
}

// ---------- Low-level helpers ----------

const BASE = "/api/method";

/** Read Frappe's CSRF token from window globals, same as folio-api. */
function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	return w.csrf_token ?? w.frappe?.csrf_token ?? "";
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * PMS endpoints return { message: <bare dict> }.
 * Accepts both that shape and a direct dict (some setups skip the wrapper).
 */
function unwrapPmsMessage<T>(parsed: unknown): T {
	if (!parsed || typeof parsed !== "object") {
		throw new ConditionApiError("Empty or non-object response from PMS endpoint", 0);
	}
	const obj = parsed as Record<string, unknown>;
	if ("message" in obj) {
		return obj.message as T;
	}
	return parsed as T;
}

async function callPms<T>(path: string, params: Record<string, string>): Promise<T> {
	const search = new URLSearchParams(params);
	const response = await fetch(`${BASE}/${path}?${search.toString()}`, {
		method: "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
		},
	});

	const text = await response.text();
	const parsed = text ? safeJson(text) : undefined;

	if (!response.ok) {
		throw new ConditionApiError(
			`PMS ${path} failed with ${response.status}`,
			response.status
		);
	}

	return unwrapPmsMessage<T>(parsed);
}

async function callPmsPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
	const response = await fetch(`${BASE}/${path}`, {
		method: "POST",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
		},
		body: JSON.stringify(body),
	});

	const text = await response.text();
	const parsed = text ? safeJson(text) : undefined;

	if (!response.ok) {
		throw new ConditionApiError(
			`PMS ${path} failed with ${response.status}`,
			response.status
		);
	}

	return unwrapPmsMessage<T>(parsed);
}

// ---------- File upload ----------

export type UploadedFile = {
	file_url: string;
	name: string;
};

/**
 * Uploads a file to Frappe using /api/method/upload_file.
 * Returns the file_url to embed in ConditionPhoto.image.
 *
 * Uses FormData + credentials:"include" + CSRF — identical auth mechanism
 * to the JSON calls above; multipart/form-data Content-Type is set by the
 * browser automatically when using FormData (do NOT set it manually).
 *
 * Pass `isPrivate: true` for sensitive uploads (e.g. guest KYC ID documents) so
 * the file lands under /private/files/ and is only served to an authenticated
 * session. Room-condition photos stay public (the default).
 */
export async function uploadConditionPhoto(file: File, isPrivate = false): Promise<UploadedFile> {
	const form = new FormData();
	form.append("file", file, file.name);
	form.append("is_private", isPrivate ? "1" : "0");
	// "Home" is the always-present root File folder. A custom subfolder must be
	// created first or Frappe's upload_file throws a ValidationError (HTTP 417).
	form.append("folder", "Home");

	const response = await fetch(`${BASE}/upload_file`, {
		method: "POST",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			// NOTE: do NOT set Content-Type here — browser sets multipart boundary automatically
		},
		body: form,
	});

	const text = await response.text();
	const parsed = text ? safeJson(text) : undefined;

	if (!response.ok) {
		throw new ConditionApiError(
			`upload_file failed with ${response.status}`,
			response.status
		);
	}

	const unwrapped = unwrapPmsMessage<UploadedFile>(parsed);
	if (!unwrapped.file_url) {
		throw new ConditionApiError("upload_file returned no file_url", response.status);
	}

	return unwrapped;
}

// ---------- Public endpoints ----------

/**
 * Captures room condition for a stay at a given stage.
 * At least one photo required (enforced by the server; block in UI before calling).
 *
 * Returns { capture, reused } — reused:true means the server returned an
 * existing capture for this stay+stage rather than creating a new one.
 */
export async function captureRoomCondition(input: {
	stay: string;
	capture_stage: CaptureStage;
	photos: ConditionPhoto[];
	overall_condition?: OverallCondition;
	notes?: string;
}): Promise<CaptureRoomConditionResult> {
	return callPmsPost<CaptureRoomConditionResult>(
		"the_reezort.pms.api.capture_room_condition",
		{
			stay: input.stay,
			capture_stage: input.capture_stage,
			photos: input.photos,
			...(input.overall_condition !== undefined
				? { overall_condition: input.overall_condition }
				: {}),
			...(input.notes !== undefined ? { notes: input.notes } : {}),
		}
	);
}

/**
 * Returns all condition captures for a stay, ordered chronologically.
 * Includes both Check-In and Check-Out stages if already captured.
 */
export async function getRoomConditionCaptures(
	stay: string
): Promise<GetRoomConditionCapturesResult> {
	return callPms<GetRoomConditionCapturesResult>(
		"the_reezort.pms.api.get_room_condition_captures",
		{ stay }
	);
}
