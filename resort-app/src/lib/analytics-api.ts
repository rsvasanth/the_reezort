/**
 * Revenue analytics API client — the_reezort.analytics.revenue.* (spec 014).
 *
 * Standard envelope, live-with-mock-fallback. The channel set is a fixed
 * computed vocabulary (not a doctype Select), so nothing here is parity-
 * guarded.
 */

import { FolioApiError } from "@/lib/folio-api";
import type { FolioApiEnvelope, FolioMessage } from "@/lib/folio-api";

export type RevenueSummary = {
	resort_property: string;
	from_date: string;
	to_date: string;
	days: number;
	days_covered: number;
	days_missing: number;
	currency: string;
	occupancy_pct: number;
	adr: number;
	revpar: number;
	room_revenue: number;
	other_revenue: number;
	total_revenue: number;
	deltas: {
		occupancy_pct: number;
		adr: number;
		revpar: number;
		room_revenue_pct: number | null;
	};
};

export type TrendPoint = {
	date: string;
	room_revenue: number;
	total_revenue: number;
	occupancy_pct: number;
	present: boolean;
};

export type DailyTrend = {
	resort_property: string;
	days: number;
	series: TrendPoint[];
};

export type ChannelName = "Direct" | "OTA" | "Corporate" | "Walk-in";

export type ChannelSlice = {
	channel: ChannelName;
	bookings: number;
	revenue: number;
	pct: number;
};

export type ChannelMix = {
	resort_property: string;
	from_date: string;
	to_date: string;
	total_revenue: number;
	channels: ChannelSlice[];
};

export type RebuildResult = { days: number; from_date: string; to_date: string };

// ---------- low-level ----------

const BASE = "/api/method";
const NS = "the_reezort.analytics.revenue";

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
	return env.data as T;
}

// ---------- endpoints ----------

export function getSummary(params: { from_date?: string; to_date?: string; resort_property?: string }): Promise<RevenueSummary> {
	return call<RevenueSummary>("get_summary", { method: "GET", params });
}

export function getDailyTrend(params: { days?: number; resort_property?: string }): Promise<DailyTrend> {
	return call<DailyTrend>("get_daily_trend", { method: "GET", params });
}

export function getChannelMix(params: { from_date?: string; to_date?: string; resort_property?: string }): Promise<ChannelMix> {
	return call<ChannelMix>("get_channel_mix", { method: "GET", params });
}

export function rebuildSnapshots(params: { from_date: string; to_date: string; resort_property?: string }): Promise<RebuildResult> {
	return call<RebuildResult>("rebuild_snapshots", { method: "POST", body: { ...params } });
}

// ---------- date helpers ----------

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export function isoDate(d: Date): string {
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

// ---------- dev mock fixtures ----------

function mockSeries(days: number): TrendPoint[] {
	const out: TrendPoint[] = [];
	const to = new Date();
	to.setDate(to.getDate() - 1);
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(to);
		d.setDate(d.getDate() - i);
		// Smooth wave so the mock chart reads like real occupancy rhythm.
		const wave = 0.5 + 0.4 * Math.sin((i / days) * Math.PI * 3);
		const occ = Math.round(45 + wave * 45);
		const roomRev = Math.round(180000 + wave * 160000);
		out.push({ date: isoDate(d), room_revenue: roomRev, total_revenue: Math.round(roomRev * 1.18), occupancy_pct: occ, present: true });
	}
	return out;
}

export function mockSummary(days: number): RevenueSummary {
	const range = rangeEndingYesterday(days);
	return {
		resort_property: "REEZORT",
		from_date: range.from_date,
		to_date: range.to_date,
		days,
		days_covered: days,
		days_missing: 0,
		currency: "INR",
		occupancy_pct: 68,
		adr: 14200,
		revpar: 9656,
		room_revenue: 2860000,
		other_revenue: 515000,
		total_revenue: 3375000,
		deltas: { occupancy_pct: 4, adr: 800, revpar: 1200, room_revenue_pct: 12 },
	};
}

export function mockTrend(days: number): DailyTrend {
	return { resort_property: "REEZORT", days, series: mockSeries(days) };
}

export const MOCK_CHANNELS: ChannelMix = {
	resort_property: "REEZORT",
	from_date: "",
	to_date: "",
	total_revenue: 3375000,
	channels: [
		{ channel: "Direct", bookings: 62, revenue: 1822500, pct: 54 },
		{ channel: "OTA", bookings: 21, revenue: 607500, pct: 18 },
		{ channel: "Corporate", bookings: 18, revenue: 708750, pct: 21 },
		{ channel: "Walk-in", bookings: 7, revenue: 236250, pct: 7 },
	],
};

// ---------- compact INR (₹28.6L / ₹1.2Cr) ----------

export function formatINRCompact(n: number): string {
	if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)}Cr`;
	if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
	if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
	return `₹${Math.round(n)}`;
}

export function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
