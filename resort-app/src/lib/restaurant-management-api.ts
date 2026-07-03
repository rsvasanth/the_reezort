/**
 * F&B management API client — the_reezort.fnb.management.* (spec 006 · Slice 5).
 *
 * Six operator surfaces over one live Python module: sales analytics, sales
 * calendar, waste report, dish performance, waiter assignment, and the
 * restaurant audit trail. Same live-with-mock-fallback contract as the other
 * clients:
 *  - standard envelope { ok, data, warnings, blockers, next_actions }
 *  - throws FolioApiError on non-2xx / bad body
 *  - screens fall back to MOCK_* fixtures on network/5xx so the hub renders
 *    against realistic data; a true 4xx (denied / bad args) surfaces as an
 *    error state, never fake data.
 *
 * WaiterAssignmentStatus MIRRORS the Waiter Assignment.status Select and is
 * guarded by `yarn check:contracts` — do not hand-edit a value the doctype
 * doesn't emit. Trend / channel-style vocabularies are computed server-side
 * (not Selects) and are intentionally not parity-guarded.
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";

// ---------- doctype-mirrored union (parity-guarded) ----------

export type WaiterAssignmentStatus = "Active" | "Completed" | "Cancelled";

// ---------- derived vocab (computed server-side, not a Select) ----------

export type DishTrend = "up" | "flat" | "down" | "new";

// ---------- shapes ----------

export type SalesDeltas = {
	orders_pct: number | null;
	revenue_pct: number | null;
	avg_check_pct: number | null;
};

export type SalesSummary = {
	from_date: string;
	to_date: string;
	outlet: string | null;
	total_orders: number;
	settled_orders: number;
	cancelled_orders: number;
	revenue: number;
	avg_check: number;
	cancel_rate_pct: number;
	deltas: SalesDeltas;
};

export type DailySalesPoint = {
	date: string;
	orders: number;
	revenue: number;
	avg_check: number;
	present: boolean;
};

export type DailySales = {
	from_date: string;
	to_date: string;
	outlet: string | null;
	series: DailySalesPoint[];
};

export type TopDish = {
	menu_item: string;
	item_name: string;
	image: string | null;
	category: string | null;
	price: number | null;
	qty_sold: number;
	revenue: number;
};

export type TopDishes = {
	from_date: string;
	to_date: string;
	outlet: string | null;
	dishes: TopDish[];
};

export type WaiterSales = {
	user: string;
	waiter_name: string | null;
	orders: number;
	revenue: number;
	covers: number;
	avg_check: number;
};

export type SalesByWaiter = {
	from_date: string;
	to_date: string;
	outlet: string | null;
	waiters: WaiterSales[];
};

export type CalendarTopDish = {
	menu_item: string;
	item_name: string;
	qty: number;
};

export type CalendarDay = {
	date: string;
	day_of_week: number; // ISO weekday, 1=Mon … 7=Sun
	orders: number;
	revenue: number;
	top_dish: CalendarTopDish | null;
	waste_value: number;
};

export type SalesCalendar = {
	year: number;
	month: number;
	outlet: string | null;
	days: CalendarDay[];
	totals: { revenue: number; orders: number; waste_value: number };
};

export type DishPerformanceRow = {
	menu_item: string;
	item_name: string;
	image: string | null;
	category: string | null;
	unit_price: number;
	unit_cost: number;
	unit_margin_pct: number | null;
	qty_sold: number;
	revenue: number;
	total_cost: number;
	gross_margin: number;
	gross_margin_pct: number;
	prev_qty_sold: number;
	delta_qty: number;
	delta_pct: number | null;
	trend: DishTrend;
};

export type SlowMover = {
	menu_item: string;
	item_name: string;
	image: string | null;
	category: string | null;
	unit_price: number;
};

export type DishPerformance = {
	from_date: string;
	to_date: string;
	outlet: string | null;
	dishes: DishPerformanceRow[];
	slow_movers: SlowMover[];
};

export type WaiterAssignmentRow = {
	assignment: string;
	outlet: string;
	table: string;
	table_code: string | null;
	table_name: string | null;
	table_zone: string | null;
	table_seats: number | null;
	waiter_user: string;
	waiter_name: string | null;
	waiter_employee: string | null;
	shift_start: string;
	shift_end: string;
	status: WaiterAssignmentStatus;
	notes: string | null;
	orders_today: number;
};

export type WaiterAssignments = {
	outlet: string | null;
	date: string;
	assignments: WaiterAssignmentRow[];
};

export type AssignWaiterInput = {
	restaurant_table: string;
	waiter_user: string;
	shift_start: string;
	shift_end: string;
	outlet?: string;
	resort_property?: string;
	notes?: string;
};

// ---------- low-level ----------

const BASE = "/api/method";
const NS = "the_reezort.fnb.management";

function readCsrfToken(): string {
	const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf_token"]');
	if (meta?.content) return meta.content;
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
	method: string,
	init:
		| { method: "GET"; params?: Record<string, string | number | undefined> }
		| { method: "POST"; body: Record<string, unknown> },
): Promise<T> {
	let url = `${BASE}/${NS}.${method}`;
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
		throw new FolioApiError(`${method} failed with ${res.status}`, {
			status: res.status,
			blockers: extractMessages(parsed, "blockers"),
			warnings: extractMessages(parsed, "warnings"),
			rawEnvelope: parsed as FolioApiEnvelope<unknown> | undefined,
		});
	}
	const env = unwrap<FolioApiEnvelope<T>>(parsed);
	if (!env || typeof env !== "object" || env.data === undefined) {
		throw new FolioApiError(`${method} returned an unexpected body`, { status: res.status });
	}
	return env.data;
}

// ---------- endpoints ----------

type Range = { from_date?: string; to_date?: string; outlet?: string };

export function getSalesSummary(params: Range): Promise<SalesSummary> {
	return call<SalesSummary>("get_sales_summary", { method: "GET", params });
}

export function getDailySales(params: Range): Promise<DailySales> {
	return call<DailySales>("get_daily_sales", { method: "GET", params });
}

export function topDishes(params: Range & { limit?: number }): Promise<TopDishes> {
	return call<TopDishes>("top_dishes", { method: "GET", params });
}

export function salesByWaiter(params: Range): Promise<SalesByWaiter> {
	return call<SalesByWaiter>("sales_by_waiter", { method: "GET", params });
}

export function getSalesCalendar(params: { year: number; month: number; outlet?: string }): Promise<SalesCalendar> {
	return call<SalesCalendar>("get_sales_calendar", { method: "GET", params });
}

export function getDishPerformance(params: Range): Promise<DishPerformance> {
	return call<DishPerformance>("get_dish_performance", { method: "GET", params });
}

export function listWaiterAssignments(params: { outlet?: string; on_date?: string; status?: string }): Promise<WaiterAssignments> {
	return call<WaiterAssignments>("list_waiter_assignments", { method: "GET", params });
}

export function assignWaiter(input: AssignWaiterInput): Promise<{ assignment: string; waiter_employee: string | null }> {
	return call("assign_waiter", { method: "POST", body: { ...input } });
}

export function unassignWaiter(assignment: string, reason?: string): Promise<{ assignment: string; status: WaiterAssignmentStatus }> {
	return call("unassign_waiter", { method: "POST", body: { assignment, reason } });
}

// ---------- dev mock fixtures (network/5xx fallback before deploy) ----------

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function isoDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** { from_date, to_date } for the last `days` ending yesterday. */
export function rangeEndingYesterday(days: number): { from_date: string; to_date: string } {
	const to = new Date();
	to.setDate(to.getDate() - 1);
	const from = new Date(to);
	from.setDate(from.getDate() - (days - 1));
	return { from_date: isoDate(from), to_date: isoDate(to) };
}

export function mockSummary(range: { from_date: string; to_date: string }): SalesSummary {
	return {
		from_date: range.from_date,
		to_date: range.to_date,
		outlet: null,
		total_orders: 412,
		settled_orders: 388,
		cancelled_orders: 12,
		revenue: 1148400,
		avg_check: 2960,
		cancel_rate_pct: 2.9,
		deltas: { orders_pct: 8.4, revenue_pct: 11.2, avg_check_pct: 2.6 },
	};
}

export function mockDailySales(range: { from_date: string; to_date: string }): DailySales {
	const series: DailySalesPoint[] = [];
	const from = new Date(`${range.from_date}T00:00:00`);
	const to = new Date(`${range.to_date}T00:00:00`);
	let i = 0;
	for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1), i++) {
		const wave = 0.5 + 0.4 * Math.sin((i / 12) * Math.PI);
		const orders = Math.round(6 + wave * 12);
		const revenue = Math.round(orders * (2600 + wave * 900));
		series.push({ date: isoDate(d), orders, revenue, avg_check: Math.round(revenue / Math.max(orders, 1)), present: true });
	}
	return { from_date: range.from_date, to_date: range.to_date, outlet: null, series };
}

export const MOCK_TOP_DISHES: TopDishes = {
	from_date: "",
	to_date: "",
	outlet: null,
	dishes: [
		{ menu_item: "MI-BUTTER-CHK", item_name: "Butter Chicken", image: null, category: "Mains", price: 850, qty_sold: 214, revenue: 181900 },
		{ menu_item: "MI-PANEER-TK", item_name: "Paneer Tikka", image: null, category: "Starters", price: 620, qty_sold: 188, revenue: 116560 },
		{ menu_item: "MI-OLD-FASH", item_name: "Old Fashioned", image: null, category: "Bar", price: 525, qty_sold: 142, revenue: 74550 },
		{ menu_item: "MI-GARLIC-NAAN", item_name: "Garlic Naan", image: null, category: "Breads", price: 125, qty_sold: 496, revenue: 62000 },
		{ menu_item: "MI-BIRYANI", item_name: "Lamb Biryani", image: null, category: "Mains", price: 780, qty_sold: 96, revenue: 74880 },
	],
};

export const MOCK_SALES_BY_WAITER: SalesByWaiter = {
	from_date: "",
	to_date: "",
	outlet: null,
	waiters: [
		{ user: "ravi@thereezort.com", waiter_name: "Ravi Menon", orders: 118, revenue: 372600, covers: 402, avg_check: 3158 },
		{ user: "meera@thereezort.com", waiter_name: "Meera Nair", orders: 104, revenue: 318200, covers: 356, avg_check: 3059 },
		{ user: "arjun@thereezort.com", waiter_name: "Arjun Rao", orders: 92, revenue: 254100, covers: 298, avg_check: 2762 },
		{ user: "sana@thereezort.com", waiter_name: "Sana Iqbal", orders: 74, revenue: 203500, covers: 241, avg_check: 2750 },
	],
};

export function mockCalendar(year: number, month: number): SalesCalendar {
	const last = new Date(year, month, 0).getDate();
	const days: CalendarDay[] = [];
	for (let day = 1; day <= last; day++) {
		const d = new Date(year, month - 1, day);
		const wave = 0.5 + 0.4 * Math.sin((day / 7) * Math.PI);
		const orders = Math.round(4 + wave * 14);
		const revenue = Math.round(orders * (2600 + wave * 800));
		days.push({
			date: isoDate(d),
			day_of_week: ((d.getDay() + 6) % 7) + 1,
			orders,
			revenue,
			top_dish: orders > 0 ? { menu_item: "MI-BUTTER-CHK", item_name: "Butter Chicken", qty: Math.round(orders * 0.6) } : null,
			waste_value: day % 5 === 0 ? Math.round(800 + wave * 600) : 0,
		});
	}
	return {
		year,
		month,
		outlet: null,
		days,
		totals: {
			revenue: days.reduce((s, d) => s + d.revenue, 0),
			orders: days.reduce((s, d) => s + d.orders, 0),
			waste_value: days.reduce((s, d) => s + d.waste_value, 0),
		},
	};
}

export const MOCK_DISH_PERFORMANCE: DishPerformance = {
	from_date: "",
	to_date: "",
	outlet: null,
	dishes: [
		{ menu_item: "MI-BUTTER-CHK", item_name: "Butter Chicken", image: null, category: "Mains", unit_price: 850, unit_cost: 312, unit_margin_pct: 63.3, qty_sold: 214, revenue: 181900, total_cost: 66768, gross_margin: 115132, gross_margin_pct: 63.3, prev_qty_sold: 182, delta_qty: 32, delta_pct: 17.6, trend: "up" },
		{ menu_item: "MI-BIRYANI", item_name: "Lamb Biryani", image: null, category: "Mains", unit_price: 780, unit_cost: 345, unit_margin_pct: 55.8, qty_sold: 96, revenue: 74880, total_cost: 33120, gross_margin: 41760, gross_margin_pct: 55.8, prev_qty_sold: 101, delta_qty: -5, delta_pct: -5.0, trend: "flat" },
		{ menu_item: "MI-OLD-FASH", item_name: "Old Fashioned", image: null, category: "Bar", unit_price: 525, unit_cost: 148, unit_margin_pct: 71.8, qty_sold: 142, revenue: 74550, total_cost: 21016, gross_margin: 53534, gross_margin_pct: 71.8, prev_qty_sold: 176, delta_qty: -34, delta_pct: -19.3, trend: "down" },
		{ menu_item: "MI-PANEER-TK", item_name: "Paneer Tikka", image: null, category: "Starters", unit_price: 620, unit_cost: 205, unit_margin_pct: 66.9, qty_sold: 188, revenue: 116560, total_cost: 38540, gross_margin: 78020, gross_margin_pct: 66.9, prev_qty_sold: 0, delta_qty: 188, delta_pct: null, trend: "new" },
	],
	slow_movers: [
		{ menu_item: "MI-QUINOA-SLD", item_name: "Quinoa Salad", image: null, category: "Starters", unit_price: 480 },
		{ menu_item: "MI-KOMBUCHA", item_name: "House Kombucha", image: null, category: "Bar", unit_price: 320 },
	],
};

export function mockAssignments(outlet: string | null, on_date: string): WaiterAssignments {
	return {
		outlet,
		date: on_date,
		assignments: [
			{ assignment: "RZ-WSHIFT-2026-00001", outlet: outlet ?? "Signature Restaurant", table: "SIGREST-T01", table_code: "T01", table_name: "Window 1", table_zone: "Indoor", table_seats: 4, waiter_user: "ravi@thereezort.com", waiter_name: "Ravi Menon", waiter_employee: "HR-EMP-0004", shift_start: `${on_date} 10:00:00`, shift_end: `${on_date} 18:00:00`, status: "Active", notes: null, orders_today: 7 },
			{ assignment: "RZ-WSHIFT-2026-00002", outlet: outlet ?? "Signature Restaurant", table: "SIGREST-P01", table_code: "P01", table_name: "Poolside 1", table_zone: "Poolside", table_seats: 4, waiter_user: "meera@thereezort.com", waiter_name: "Meera Nair", waiter_employee: "HR-EMP-0009", shift_start: `${on_date} 12:00:00`, shift_end: `${on_date} 20:00:00`, status: "Active", notes: "Covering Sana's break 15:00–15:30", orders_today: 4 },
		],
	};
}
