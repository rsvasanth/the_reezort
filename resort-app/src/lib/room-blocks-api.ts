/**
 * Room Inventory Block API client.
 * Backs the Blocks tab in PropertyManagementScreen.
 *
 * Backend: the_reezort.property.api.{create,release,list}_room_block
 */

import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";
import { FolioApiError } from "@/lib/folio-api";

export { FolioApiError } from "@/lib/folio-api";

// ---------- Domain types ----------

/** Mirror of Room Inventory Block.block_type Select options. */
export type BlockType =
	| "Maintenance"
	| "VIP Hold"
	| "Owner Hold"
	| "Group Hold"
	| "Operational"
	| "Other";

/** Mirror of Room Inventory Block.scope Select options. */
export type BlockScope = "Room" | "Room Type";

/** Mirror of Room Inventory Block.status Select options. */
export type BlockStatus = "Active" | "Released" | "Cancelled";

export type RoomInventoryBlock = {
	name: string;
	resort_property: string;
	scope: BlockScope;
	block_type: BlockType;
	room: string | null;
	room_type: string | null;
	start_date: string;
	end_date: string;
	is_hard_block: number;
	inventory_blocking: number;
	reason: string;
	status: BlockStatus;
	created_by: string;
	released_by: string | null;
	released_at: string | null;
};

export type ListBlocksResult = {
	blocks: RoomInventoryBlock[];
	total_count: number;
	page: number;
	page_length: number;
};

export type CreateBlockPayload = {
	property: string;
	scope: BlockScope;
	room?: string;
	room_type?: string;
	block_type: BlockType;
	start_date: string;
	end_date: string;
	is_hard_block?: boolean;
	inventory_blocking?: boolean;
	reason: string;
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

function toQuery(params: Record<string, string | undefined>): string {
	const s = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== "") s.set(k, v);
	}
	return s.toString();
}

async function callBlocks<T>(
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
		throw new FolioApiError(`Blocks ${path} failed with ${response.status}`, {
			status: response.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}

	const envelope = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!envelope || typeof envelope !== "object" || envelope.data === undefined) {
		throw new FolioApiError(`Blocks ${path} returned an unexpected body`, { status: response.status });
	}
	return envelope.data;
}

// ---------- Endpoints ----------

export async function listRoomBlocks(params: {
	property: string;
	status?: BlockStatus | BlockStatus[];
	room?: string;
	room_type?: string;
	scope?: BlockScope;
	start_date?: string;
	end_date?: string;
	page?: number;
	page_length?: number;
}): Promise<ListBlocksResult> {
	const statusParam = Array.isArray(params.status)
		? params.status.join(",")
		: params.status;
	return callBlocks<ListBlocksResult>(
		"the_reezort.property.api.list_room_blocks",
		{
			method: "GET",
			params: {
				property: params.property,
				status: statusParam,
				room: params.room,
				room_type: params.room_type,
				scope: params.scope,
				start_date: params.start_date,
				end_date: params.end_date,
				page: params.page !== undefined ? String(params.page) : undefined,
				page_length: params.page_length !== undefined ? String(params.page_length) : undefined,
			},
		}
	);
}

export async function createRoomBlock(
	payload: CreateBlockPayload
): Promise<{ room_inventory_block: string; status: BlockStatus }> {
	return callBlocks<{ room_inventory_block: string; status: BlockStatus }>(
		"the_reezort.property.api.create_room_block",
		{
			method: "POST",
			body: {
				property: payload.property,
				scope: payload.scope,
				room: payload.room,
				room_type: payload.room_type,
				block_type: payload.block_type,
				start_date: payload.start_date,
				end_date: payload.end_date,
				is_hard_block: payload.is_hard_block ?? true,
				inventory_blocking: payload.inventory_blocking ?? true,
				reason: payload.reason,
			},
		}
	);
}

export async function releaseRoomBlock(
	roomInventoryBlock: string,
	reason?: string
): Promise<{ room_inventory_block: string; status: BlockStatus }> {
	return callBlocks<{ room_inventory_block: string; status: BlockStatus }>(
		"the_reezort.property.api.release_room_block",
		{
			method: "POST",
			body: { room_inventory_block: roomInventoryBlock, reason: reason ?? "" },
		}
	);
}
