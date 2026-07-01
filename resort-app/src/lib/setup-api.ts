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

export type TreeBuilding = { name: string; building_name: string; building_code: string; is_active: number };
export type TreeFloor = { name: string; building: string; floor_label: string; floor_code: string; is_active: number };
export type TreeRoomType = {
	name: string;
	room_type_name: string;
	room_type_code: string;
	max_occupancy: number;
	is_active: number;
	nightly_rate?: number;
};
export type TreeRoom = {
	name: string;
	room_number: string;
	room_name: string | null;
	building: string;
	floor: string;
	room_type: string;
	occupancy_status: string;
	housekeeping_status: string;
	maintenance_status: string;
	sellable_status: string;
	smoking_policy: string;
	is_accessible: number;
	is_active: number;
};

export type PropertyTree = {
	resort_property: string;
	buildings: TreeBuilding[];
	floors: TreeFloor[];
	room_types: TreeRoomType[];
	rooms: TreeRoom[];
	counts: { buildings: number; floors: number; room_types: number; rooms: number };
};

export type ManagedDoctype =
	| "Resort Property"
	| "Resort Building"
	| "Resort Floor"
	| "Room Type"
	| "Room"
	| "Room Amenity";

export type Amenity = {
	name: string;
	amenity_name: string;
	amenity_code: string;
	amenity_type: string;
	is_guest_visible: number;
	icon: string | null;
	is_active: number;
};

export type EquipmentCondition = "Working" | "Faulty" | "Under Repair" | "Missing" | "Not Installed";

export type RoomEquipmentItem = {
	amenity: string;
	label?: string | null;
	condition: EquipmentCondition;
	quantity?: number;
	asset?: string | null;
	notes?: string | null;
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
	nightly_rate?: number;
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

// ---------- Management (CRUD / equipment / amenity catalog) ----------

export const EQUIPMENT_CONDITIONS: EquipmentCondition[] = [
	"Working",
	"Faulty",
	"Under Repair",
	"Missing",
	"Not Installed",
];

export async function updateRecord(
	doctype: ManagedDoctype,
	name: string,
	payload: Record<string, unknown>
): Promise<{ record: Record<string, unknown>; changed: string[] }> {
	return callSetup("the_reezort.setup.management.update_record", {
		method: "POST",
		body: { doctype, name, payload },
	});
}

export async function setActive(
	doctype: ManagedDoctype,
	name: string,
	isActive: boolean
): Promise<{ name: string; is_active: number }> {
	return callSetup("the_reezort.setup.management.set_active", {
		method: "POST",
		body: { doctype, name, is_active: isActive ? 1 : 0 },
	});
}

export async function deleteRecord(
	doctype: ManagedDoctype,
	name: string
): Promise<{ deleted: string }> {
	return callSetup("the_reezort.setup.management.delete_record", {
		method: "POST",
		body: { doctype, name },
	});
}

export async function listAmenities(includeInactive = false): Promise<{ amenities: Amenity[] }> {
	return callSetup("the_reezort.setup.management.list_amenities", {
		method: "GET",
		params: includeInactive ? { include_inactive: "1" } : {},
	});
}

export async function createAmenity(payload: {
	amenity_name: string;
	amenity_code: string;
	amenity_type?: string;
	is_guest_visible?: boolean;
	icon?: string | null;
}): Promise<{ amenity: Amenity; reused: boolean }> {
	return callSetup("the_reezort.setup.management.create_amenity", {
		method: "POST",
		body: { payload },
	});
}

export async function getRoomEquipment(
	room: string
): Promise<{ room: string; room_number: string; items: RoomEquipmentItem[] }> {
	return callSetup("the_reezort.setup.management.get_room_equipment", {
		method: "GET",
		params: { room },
	});
}

// ---------- Pricing (Rate Plans / Seasons / Packages) ----------

export type RatePlanRow = {
	name: string;
	code: string;
	plan_name: string;
	room_type: string | null;
	base_rate_override: number | null;
	weekend_uplift_pct: number | null;
	refundable: 0 | 1;
	cancellation_hours: number;
	is_active: 0 | 1;
};

export type SeasonRow = {
	name: string;
	code: string;
	season_name: string;
	start_date: string;
	end_date: string;
	modifier_pct: number | null;
	absolute_rate: number | null;
	priority: number;
	is_active: 0 | 1;
};

export type PackageInclusionRow = { inclusion_name: string; quantity: number };

export type PackageRow = {
	name: string;
	code: string;
	package_name: string;
	nights: number;
	room_type: string | null;
	package_price: number;
	valid_from: string | null;
	valid_to: string | null;
	is_active: 0 | 1;
	inclusions: PackageInclusionRow[];
	inclusions_summary: string;
};

export type PricingBundle = {
	rate_plans: RatePlanRow[];
	seasons: SeasonRow[];
	packages: PackageRow[];
};

export async function listPricing(resortProperty: string): Promise<PricingBundle> {
	return callSetup<PricingBundle>("the_reezort.setup.rate_plans.list_pricing", {
		method: "GET",
		params: { resort_property: resortProperty },
	});
}

export async function upsertRatePlan(payload: Partial<RatePlanRow> & { resort_property: string }): Promise<{ rate_plan: string; reused: boolean }> {
	return callSetup("the_reezort.setup.rate_plans.upsert_rate_plan", {
		method: "POST",
		body: { payload },
	});
}

export async function upsertSeason(payload: Partial<SeasonRow> & { resort_property: string }): Promise<{ season: string; reused: boolean }> {
	return callSetup("the_reezort.setup.rate_plans.upsert_season", {
		method: "POST",
		body: { payload },
	});
}

export async function upsertPackage(payload: Partial<PackageRow> & { resort_property: string; inclusions?: PackageInclusionRow[] }): Promise<{ package: string; reused: boolean }> {
	return callSetup("the_reezort.setup.rate_plans.upsert_package", {
		method: "POST",
		body: { payload },
	});
}

export async function setPricingActive(doctype: "Rate Plan" | "Season" | "Package", name: string, isActive: boolean): Promise<{ name: string; is_active: number }> {
	return callSetup("the_reezort.setup.rate_plans.set_pricing_active", {
		method: "POST",
		body: { doctype, name, is_active: isActive ? 1 : 0 },
	});
}

export async function deletePricing(doctype: "Rate Plan" | "Season" | "Package", name: string): Promise<{ deleted: string }> {
	return callSetup("the_reezort.setup.rate_plans.delete_pricing", {
		method: "POST",
		body: { doctype, name },
	});
}

export async function setRoomEquipment(
	room: string,
	items: RoomEquipmentItem[]
): Promise<{ room: string; count: number }> {
	return callSetup("the_reezort.setup.management.set_room_equipment", {
		method: "POST",
		body: { room, items },
	});
}
