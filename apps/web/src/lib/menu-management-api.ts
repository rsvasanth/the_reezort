/**
 * Menu Management API client — the_reezort.fnb.menu_management.* (spec 006 slice menu).
 *
 * Covers all menu item CRUD, availability toggle, price updates, recipe (BOM)
 * management, and the ingredient catalog.  Follows the same envelope/transport
 * pattern as restaurant-api.ts and room-blocks-api.ts.
 *
 * String-literal unions below MIRROR the backing doctype Select options and
 * are guarded by `yarn check:contracts` — do not hand-edit a value that the
 * doctype doesn't emit.
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";

// ---------- doctype-mirrored unions (parity-guarded) ----------

export type MenuCategory =
	| "Starters"
	| "Mains"
	| "Desserts"
	| "Beverages"
	| "Alcohol"
	| "Sides"
	| "Breakfast"
	| "Other";

export type MenuVegFlag = "Veg" | "Non-veg" | "Egg" | "Vegan";

// ---------- shapes ----------

export type MenuItemDetail = {
	name: string;
	outlet: string;
	item_name: string;
	item_code_short: string;
	erpnext_item: string | null;
	category: MenuCategory;
	price: number;
	currency: string;
	is_available: number;
	description: string | null;
	veg_flag: MenuVegFlag;
	spice_level: number | null;
	prep_time_minutes: number | null;
	allergens: string | null;
	tags: string | null;
	image: string | null;
};

export type RecipeIngredient = {
	item_code: string;
	qty: number;
	uom: string;
	rate: number;
	amount: number;
	item_name: string;
	image: string | null;
	item_group: string;
};

export type MenuItemRecipe = {
	bom: string | null;
	ingredients: RecipeIngredient[];
	cost: number;
};

export type MenuItemFull = {
	menu_item: MenuItemDetail;
	recipe: MenuItemRecipe;
	margin: number | null;
	margin_pct: number | null;
};

export type IngredientCatalogRow = {
	name: string;
	item_code: string;
	item_name: string;
	item_group: string;
	stock_uom: string;
	valuation_rate: number;
	standard_rate: number;
	image: string | null;
	disabled: number;
};

export type CreateMenuItemPayload = {
	item_name: string;
	outlet: string;
	category: MenuCategory;
	price: number;
	veg_flag?: MenuVegFlag;
	spice_level?: number;
	prep_time_minutes?: number;
	description?: string;
	allergens?: string;
	tags?: string;
	image?: string;
	is_available?: number;
	item_code_short?: string;
	currency?: string;
};

export type UpdateMenuItemPayload = Partial<
	Omit<CreateMenuItemPayload, "outlet" | "item_code_short" | "currency">
>;

export type RecipeIngredientInput = {
	item_code: string;
	qty: number;
	uom?: string;
};

// ---------- transport ----------

const BASE = "/api/method";
const NS = "the_reezort.fnb.menu_management";
const INV_NS = "the_reezort.fnb.inventory";

function readCsrfToken(): string {
	const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf_token"]');
	if (meta?.content) return meta.content;
	const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
	return w.csrf_token ?? w.frappe?.csrf_token ?? "";
}

function safeJson(text: string): unknown {
	try { return JSON.parse(text); } catch { return undefined; }
}

function unwrap<T>(parsed: unknown): T | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	return (parsed as { message?: T }).message;
}

function extractMessages(parsed: unknown, key: "blockers" | "warnings"): FolioMessage[] {
	const env = unwrap<FolioApiEnvelope<unknown>>(parsed);
	const list = env && (env as Record<string, unknown>)[key];
	return Array.isArray(list) ? (list as FolioMessage[]) : [];
}

async function call<T>(
	fullPath: string,
	init:
		| { method: "GET"; params?: Record<string, string | number | undefined> }
		| { method: "POST"; body: Record<string, unknown> },
): Promise<T> {
	let url = `${BASE}/${fullPath}`;
	if (init.method === "GET" && init.params) {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(init.params)) {
			if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
		}
		const qs = q.toString();
		if (qs) url += `?${qs}`;
	}
	const res = await fetch(url, {
		method: init.method,
		credentials: "include",
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": readCsrfToken(),
			...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
	});
	const text = await res.text();
	const parsed = text ? safeJson(text) : undefined;
	if (!res.ok) {
		throw new FolioApiError(`${fullPath} failed with ${res.status}`, {
			status: res.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}
	const env = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!env || typeof env !== "object" || env.data === undefined) {
		throw new FolioApiError(`${fullPath} returned an unexpected body`, { status: res.status });
	}
	return env.data;
}

// ---------- endpoints ----------

export function createMenuItem(payload: CreateMenuItemPayload): Promise<{ menu_item: MenuItemDetail }> {
	return call(`${NS}.create_menu_item`, { method: "POST", body: payload as Record<string, unknown> });
}

export function updateMenuItem(
	menuItem: string,
	payload: UpdateMenuItemPayload,
): Promise<{ menu_item: MenuItemDetail }> {
	return call(`${NS}.update_menu_item`, {
		method: "POST",
		body: { menu_item: menuItem, payload },
	});
}

export function setMenuItemPrice(
	menuItem: string,
	price: number,
): Promise<{ menu_item: MenuItemDetail }> {
	return call(`${NS}.set_menu_item_price`, {
		method: "POST",
		body: { menu_item: menuItem, price },
	});
}

export function toggleMenuItemAvailability(
	menuItem: string,
	isAvailable: boolean,
): Promise<{ menu_item: MenuItemDetail }> {
	return call(`${NS}.toggle_menu_item_availability`, {
		method: "POST",
		body: { menu_item: menuItem, is_available: isAvailable ? 1 : 0 },
	});
}

export function setMenuItemRecipe(
	menuItem: string,
	ingredients: RecipeIngredientInput[],
): Promise<{
	menu_item: string;
	bom: string;
	ingredient_count: number;
	recipe_cost: number;
	menu_price: number;
	margin: number;
}> {
	return call(`${NS}.set_menu_item_recipe`, {
		method: "POST",
		body: { menu_item: menuItem, ingredients },
	});
}

export function getMenuItemDetail(menuItem: string): Promise<MenuItemFull> {
	return call(`${NS}.get_menu_item_detail`, {
		method: "GET",
		params: { menu_item: menuItem },
	});
}

export function listIngredients(params?: {
	search?: string;
	item_group?: string;
}): Promise<{ ingredients: IngredientCatalogRow[] }> {
	return call(`${INV_NS}.list_ingredients`, {
		method: "GET",
		params: params as Record<string, string | undefined>,
	});
}
