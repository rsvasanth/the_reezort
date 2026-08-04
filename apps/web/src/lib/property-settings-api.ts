/**
 * Property Settings API client.
 * Backs the Settings tab in PropertyManagementScreen.
 *
 * Backend: the_reezort.the_reezort.doctype.property_settings.property_settings
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

// ---------- Domain types ----------

/** Mirror of Property Settings.room_identifier_uniqueness Select options. */
export type RoomIdentifierUniqueness = "Property" | "Building";

/** Mirror of Property Settings.hard_block_overlap_policy Select options. */
export type HardBlockOverlapPolicy = "Strict" | "Allow Same Source" | "Manual Approval";

export type PropertySettings = {
	name: string;
	resort_property: string;
	allow_dirty_allocation_default: number;
	room_identifier_uniqueness: RoomIdentifierUniqueness;
	hard_block_overlap_policy: HardBlockOverlapPolicy;
	default_room_naming_series: string;
};

export type PropertySettingsUpdate = {
	allow_dirty_allocation_default?: number;
	room_identifier_uniqueness?: RoomIdentifierUniqueness;
	hard_block_overlap_policy?: HardBlockOverlapPolicy;
	default_room_naming_series?: string;
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

async function callSettings<T>(
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
		throw new FolioApiError(`Settings ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Settings ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

// ---------- Endpoints ----------

export async function getPropertySettings(resortProperty: string): Promise<PropertySettings> {
	return callSettings<PropertySettings>(
		"the_reezort.the_reezort.doctype.property_settings.property_settings.get_property_settings",
		{ method: "GET", params: { resort_property: resortProperty } }
	);
}

export async function updatePropertySettings(
	resortProperty: string,
	settings: PropertySettingsUpdate
): Promise<PropertySettings> {
	return callSettings<PropertySettings>(
		"the_reezort.the_reezort.doctype.property_settings.property_settings.update_property_settings",
		{ method: "POST", body: { resort_property: resortProperty, settings } }
	);
}
