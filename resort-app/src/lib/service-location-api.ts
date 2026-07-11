/**
 * Service Location API client.
 * Backs the Locations tab in PropertyManagementScreen.
 *
 * Backend: the_reezort.setup.management.*_service_location / set_active / delete_record
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

// ---------- Domain types ----------

/** Mirror of Service Location.location_type Select options. */
export type ServiceLocationType =
	| "Restaurant"
	| "Bar"
	| "Cafe"
	| "Room Service"
	| "Spa"
	| "Gym"
	| "Pool"
	| "Retail"
	| "Activity"
	| "Other";

/** Mirror of Operating Hours.day_of_week Select options. */
export type DayOfWeek =
	| "Monday"
	| "Tuesday"
	| "Wednesday"
	| "Thursday"
	| "Friday"
	| "Saturday"
	| "Sunday";

export type OperatingHoursRow = {
	day_of_week: DayOfWeek;
	is_closed: number;
	opens_at: string;
	closes_at: string;
};

export type ServiceLocation = {
	name: string;
	resort_property: string;
	location_name: string;
	location_code: string;
	location_type: ServiceLocationType;
	building: string | null;
	floor: string | null;
	can_bill_direct: number;
	can_post_to_folio: number;
	default_cost_center: string | null;
	default_warehouse: string | null;
	is_active: number;
	operating_hours: OperatingHoursRow[];
};

export type CreateServiceLocationPayload = {
	resort_property: string;
	location_name: string;
	location_code: string;
	location_type: ServiceLocationType;
	building?: string;
	floor?: string;
	can_bill_direct?: boolean;
	can_post_to_folio?: boolean;
	operating_hours?: Partial<OperatingHoursRow>[];
};

export type UpdateServiceLocationPayload = {
	location_name?: string;
	location_type?: ServiceLocationType;
	building?: string | null;
	floor?: string | null;
	can_bill_direct?: number;
	can_post_to_folio?: number;
	operating_hours?: Partial<OperatingHoursRow>[];
};

// ---------- Transport ----------

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

async function callMgmt<T>(
	path: string,
	init:
		| { method: "GET"; params: Record<string, string | undefined> }
		| { method: "POST"; body: Record<string, unknown> }
): Promise<T> {
	const url =
		init.method === "GET"
			? `${BASE}/${path}?${new URLSearchParams(
				Object.fromEntries(
					Object.entries((init as { method: "GET"; params: Record<string, string | undefined> }).params)
						.filter(([, v]) => v !== undefined && v !== "")
				) as Record<string, string>
			)}`
			: `${BASE}/${path}`;

	const response = await fetch(url, {
		method: init.method,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: init.method === "POST" ? JSON.stringify((init as { method: "POST"; body: Record<string, unknown> }).body) : undefined,
	});

	const text = await response.text();
	const parsed = text ? safeJson(text) : undefined;

	if (!response.ok) {
		throw new FolioApiError(`ServiceLocation ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`ServiceLocation ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

// ---------- Endpoints ----------

export async function listServiceLocations(
	resortProperty: string,
	includeInactive = false
): Promise<{ locations: ServiceLocation[] }> {
	return callMgmt<{ locations: ServiceLocation[] }>(
		"the_reezort.setup.management.list_service_locations",
		{
			method: "GET",
			params: {
				resort_property: resortProperty,
				include_inactive: includeInactive ? "1" : undefined,
			},
		}
	);
}

export async function createServiceLocation(
	payload: CreateServiceLocationPayload
): Promise<{ location: ServiceLocation }> {
	return callMgmt<{ location: ServiceLocation }>(
		"the_reezort.setup.management.create_service_location",
		{ method: "POST", body: { payload } }
	);
}

export async function updateServiceLocation(
	name: string,
	payload: UpdateServiceLocationPayload
): Promise<{ location: ServiceLocation }> {
	return callMgmt<{ location: ServiceLocation }>(
		"the_reezort.setup.management.update_service_location",
		{ method: "POST", body: { name, payload } }
	);
}

export async function setServiceLocationActive(
	name: string,
	isActive: boolean
): Promise<{ name: string; is_active: number }> {
	return callMgmt<{ name: string; is_active: number }>(
		"the_reezort.setup.management.set_active",
		{ method: "POST", body: { doctype: "Service Location", name, is_active: isActive ? 1 : 0 } }
	);
}

export async function deleteServiceLocation(
	name: string
): Promise<{ deleted: string }> {
	return callMgmt<{ deleted: string }>(
		"the_reezort.setup.management.delete_record",
		{ method: "POST", body: { doctype: "Service Location", name } }
	);
}
