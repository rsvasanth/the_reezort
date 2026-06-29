/**
 * Property Setup API client for the_reezort.setup.api.* whitelisted methods.
 *
 * Drives the guided onboarding wizard:
 *   Resort Property -> Resort Building -> Resort Floor -> Room Type -> Rooms
 *
 * Same transport as the folio/housekeeping clients: raw fetch with
 * credentials:"include", CSRF header, envelope unwrap, FolioApiError on failure.
 * Field names mirror the doctypes exactly — see the_reezort/setup/api.py.
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

// ---------- Domain types (mirror doctype fields) ----------

// Room doctype: smoking_policy Select — keep in lockstep with the doctype options.
export type SmokingPolicy = "Non-Smoking" | "Smoking" | "Flexible";

export type CompanyOption = { name: string; default_currency: string | null };

export type PropertyOption = {
	name: string;
	property_name: string;
	property_code: string;
	company: string;
};

export type SetupOptions = {
	companies: CompanyOption[];
	currencies: string[];
	properties: PropertyOption[];
};

export type PropertyRecord = {
	name: string;
	property_name: string;
	property_code: string;
	company: string;
	default_currency: string | null;
	timezone: string;
	is_active: number;
};

export type BuildingRecord = {
	name: string;
	resort_property: string;
	building_name: string;
	building_code: string;
};

export type FloorRecord = {
	name: string;
	resort_property: string;
	building: string;
	floor_label: string;
	floor_code: string;
};

export type RoomTypeRecord = {
	name: string;
	resort_property: string;
	room_type_name: string;
	room_type_code: string;
	standard_adults: number;
	max_occupancy: number;
};

export type PropertyTree = {
	resort_property: string;
	buildings: { name: string; building_name: string; building_code: string }[];
	floors: { name: string; building: string; floor_label: string; floor_code: string }[];
	room_types: { name: string; room_type_name: string; room_type_code: string; max_occupancy: number }[];
	rooms: { name: string; room_number: string; building: string; floor: string; room_type: string }[];
	counts: { buildings: number; floors: number; room_types: number; rooms: number };
};

export type BulkRoomResult = {
	created: string[];
	skipped: string[];
	created_count: number;
	skipped_count: number;
};

// ---------- Payloads ----------

export type CreatePropertyPayload = {
	property_name: string;
	property_code: string;
	company: string;
	timezone: string;
	default_currency?: string | null;
	address?: string | null;
	phone?: string | null;
	email?: string | null;
	tax_region?: string | null;
};

export type CreateBuildingPayload = {
	resort_property: string;
	building_name: string;
	building_code: string;
	display_order?: number;
};

export type CreateFloorPayload = {
	resort_property: string;
	building: string;
	floor_label: string;
	floor_code: string;
	display_order?: number;
};

export type CreateRoomTypePayload = {
	resort_property: string;
	room_type_name: string;
	room_type_code: string;
	standard_adults: number;
	max_occupancy: number;
	standard_children?: number;
	description?: string | null;
	bed_configuration?: string | null;
};

export type CreateRoomsBulkPayload = {
	resort_property: string;
	building: string;
	floor: string;
	room_type: string;
	room_numbers: string[];
	smoking_policy?: SmokingPolicy;
};

// ---------- Transport ----------

const BASE = "/api/method";

function readCsrfToken(): string {
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	const token = w.csrf_token ?? w.frappe?.csrf_token ?? "";
	// The www page renders the literal string "None" when no token is set.
	return token === "None" ? "" : token;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
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
	const search = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== "") search.set(k, v);
	}
	return search.toString();
}

async function callSetup<T>(
	path: string,
	init:
		| { method: "GET"; params: Record<string, string | undefined> }
		| { method: "POST"; body: Record<string, unknown> }
): Promise<T> {
	const url =
		init.method === "GET" ? `${BASE}/${path}?${toQuery(init.params)}` : `${BASE}/${path}`;

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
		throw new FolioApiError(`Setup ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Setup ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

// ---------- Endpoints ----------

export async function listSetupOptions(): Promise<SetupOptions> {
	return callSetup<SetupOptions>("the_reezort.setup.api.list_setup_options", {
		method: "GET",
		params: {},
	});
}

export async function getPropertyTree(resortProperty: string): Promise<PropertyTree> {
	return callSetup<PropertyTree>("the_reezort.setup.api.get_property_tree", {
		method: "GET",
		params: { resort_property: resortProperty },
	});
}

export async function createProperty(
	payload: CreatePropertyPayload
): Promise<{ property: PropertyRecord; reused: boolean }> {
	return callSetup("the_reezort.setup.api.create_property", { method: "POST", body: { payload } });
}

export async function createBuilding(
	payload: CreateBuildingPayload
): Promise<{ building: BuildingRecord; reused: boolean }> {
	return callSetup("the_reezort.setup.api.create_building", { method: "POST", body: { payload } });
}

export async function createFloor(
	payload: CreateFloorPayload
): Promise<{ floor: FloorRecord; reused: boolean }> {
	return callSetup("the_reezort.setup.api.create_floor", { method: "POST", body: { payload } });
}

export async function createRoomType(
	payload: CreateRoomTypePayload
): Promise<{ room_type: RoomTypeRecord; reused: boolean }> {
	return callSetup("the_reezort.setup.api.create_room_type", { method: "POST", body: { payload } });
}

export async function createRoomsBulk(payload: CreateRoomsBulkPayload): Promise<BulkRoomResult> {
	return callSetup("the_reezort.setup.api.create_rooms_bulk", { method: "POST", body: { payload } });
}
