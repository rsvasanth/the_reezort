/**
 * RevenueDashboard — #/analytics/revenue (spec 014 first slice).
 *
 * KPI strip (occupancy / ADR / RevPAR / room revenue with period deltas), a
 * daily revenue trend (recharts bars + occupancy line, "no data" days paler),
 * and channel mix. Range picker 7/30/90d. Partial-data + empty states, and a
 * System-Manager-only snapshot rebuild. Live-with-mock fallback.
 */

import { useCallback, useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace";
import { useFrappeAuth } from "frappe-react-sdk";
import { motion } from "motion/react";
import {
	Bar,
	CartesianGrid,
	Cell,
	ComposedChart,
	Line,
	ResponsiveContainer,
	Tooltip as RTooltip,
	XAxis,
	YAxis,
} from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import { useUserProfile } from "@/hooks/use-user-profile";
import {
	MOCK_CHANNELS,
	formatINR,
	formatINRCompact,
	getChannelMix,
	getDailyTrend,
	getSummary,
	mockSummary,
	mockTrend,
	rangeEndingYesterday,
	rebuildSnapshots,
	type ChannelMix,
	type DailyTrend,
	type RevenueSummary,
} from "@/lib/analytics-api";

type LoadState = "loading" | "live" | "mock" | "error";

const RANGES = [
	{ key: "7", label: "Last 7 days" },
	{ key: "30", label: "Last 30 days" },
	{ key: "90", label: "Last 90 days" },
] as const;

const CHANNEL_COLOR: Record<string, string> = {
	Direct: "bg-brass",
	Corporate: "bg-primary",
	OTA: "bg-success",
	"Walk-in": "bg-muted-foreground",
};

export default function RevenueDashboard() {
	const { currentUser } = useFrappeAuth();
	const profile = useUserProfile(currentUser ?? null);
	const [days, setDays] = useState(30);
	const [summary, setSummary] = useState<RevenueSummary | null>(null);
	const [trend, setTrend] = useState<DailyTrend | null>(null);
	const [channels, setChannels] = useState<ChannelMix | null>(null);
	const [state, setState] = useState<LoadState>("loading");
	const [rebuilding, setRebuilding] = useState(false);

	const load = useCallback(() => {
		setState("loading");
		const range = rangeEndingYesterday(days);
		Promise.all([
			getSummary(range),
			getDailyTrend({ days }),
			getChannelMix(range),
		])
			.then(([s, t, c]) => {
				setSummary(s);
				setTrend(t);
				setChannels(c);
				setState("live");
			})
			.catch((error: unknown) => {
				if (error instanceof FolioApiError && error.status >= 400 && error.status < 500) {
					setState("error");
					return;
				}
				setSummary(mockSummary(days));
				setTrend(mockTrend(days));
				setChannels(MOCK_CHANNELS);
				setState("mock");
			});
	}, [days]);

	useEffect(() => {
		load();
	}, [load]);

	async function rebuild() {
		if (!summary || rebuilding) return;
		setRebuilding(true);
		try {
			const res = await rebuildSnapshots({ from_date: summary.from_date, to_date: summary.to_date });
			toast.success(`Rebuilt ${res.days} day${res.days === 1 ? "" : "s"}`);
			load();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Rebuild failed", { description: msg });
		} finally {
			setRebuilding(false);
		}
	}

	const canRebuild = !!profile?.isSystemManager;

	if (state === "loading") {
		return (
			<WorkspacePage title="Revenue" subtitle="Rooms, F&B and ancillary performance.">
				<Skeleton className="h-9 w-48" />
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
				</div>
				<Skeleton className="h-72 rounded-xl" />
			</WorkspacePage>
		);
	}

	if (state === "error" || !summary || !trend || !channels) {
		return (
			<WorkspacePage title="Revenue" subtitle="Rooms, F&B and ancillary performance.">
				<p className="text-sm text-muted-foreground">Could not load revenue analytics.</p>
				<Button variant="outline" onClick={load}><RefreshCw className="mr-1.5 size-4" /> Retry</Button>
			</WorkspacePage>
		);
	}

	const empty = summary.days_missing >= summary.days;
	const partial = summary.days_missing > 0 && summary.days_missing < summary.days;
	const goToPeriod = () => gotoReservations(summary.from_date, summary.to_date);

	return (
		<WorkspacePage title="Revenue" subtitle="Rooms, F&B and ancillary performance.">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<Badge variant="outline">{state === "mock" ? "Mock" : "Live"}</Badge>
						<Badge variant="secondary">Analytics</Badge>
					</div>
					<h1 className="font-display text-3xl font-light tracking-tight">Revenue</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{summary.from_date} → {summary.to_date} · {summary.days_covered}/{summary.days} days
					</p>
				</div>
				<div className="flex items-center gap-2">
					{canRebuild ? (
						<Button variant="outline" onClick={rebuild} disabled={rebuilding} data-testid="rebuild-snapshots">
							{rebuilding ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
							Rebuild snapshots
						</Button>
					) : null}
					<Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
						<SelectTrigger className="w-40" data-testid="range-picker"><SelectValue /></SelectTrigger>
						<SelectContent>
							{RANGES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
						</SelectContent>
					</Select>
				</div>
			</div>

			{partial ? (
				<div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
					<AlertTriangle className="size-4 shrink-0" />
					{summary.days_missing} day{summary.days_missing === 1 ? "" : "s"} missing snapshots.
					{canRebuild ? " Rebuild to heal the series." : ""}
				</div>
			) : null}

			{empty ? (
				<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
					<p className="text-sm text-muted-foreground">No revenue in this window.</p>
					{canRebuild ? (
						<Button variant="outline" onClick={rebuild} disabled={rebuilding}>Rebuild snapshots</Button>
					) : null}
				</div>
			) : (
				<>
					<motion.div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" variants={staggerContainer} initial="hidden" animate="show">
						<KpiCard label="Occupancy" value={`${Math.round(summary.occupancy_pct)}%`} delta={summary.deltas.occupancy_pct} deltaLabel={`${fmtSigned(summary.deltas.occupancy_pct)} pp`} onClick={goToPeriod} />
						<KpiCard label="ADR" value={formatINR(summary.adr)} delta={summary.deltas.adr} deltaLabel={fmtSignedMoney(summary.deltas.adr)} onClick={goToPeriod} />
						<KpiCard label="RevPAR" value={formatINR(summary.revpar)} delta={summary.deltas.revpar} deltaLabel={fmtSignedMoney(summary.deltas.revpar)} onClick={goToPeriod} />
						<KpiCard label="Room revenue" value={formatINRCompact(summary.room_revenue)} delta={summary.deltas.room_revenue_pct} deltaLabel={summary.deltas.room_revenue_pct === null ? "—" : `${fmtSigned(summary.deltas.room_revenue_pct)}%`} onClick={goToPeriod} />
					</motion.div>

					<Card>
						<CardContent className="p-5">
							<div className="mb-4 flex items-baseline justify-between">
								<h2 className="font-display text-base font-normal">Daily revenue</h2>
								<span className="text-[11px] text-muted-foreground">Room revenue · occupancy overlay</span>
							</div>
							<TrendChart trend={trend} />
						</CardContent>
					</Card>

					<Card>
						<CardContent className="p-5">
							<h2 className="font-display text-base font-normal">Booking channel mix</h2>
							<div className="mt-4 flex flex-col gap-3">
								{channels.channels.map((c) => (
									<div key={c.channel} className="flex items-center gap-3">
										<span className="w-20 shrink-0 text-sm">{c.channel}</span>
										<div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
											<div className={`h-full rounded-full ${CHANNEL_COLOR[c.channel] ?? "bg-muted-foreground"}`} style={{ width: `${Math.max(c.pct, 0)}%` }} />
										</div>
										<span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{Math.round(c.pct)}%</span>
										<span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{formatINRCompact(c.revenue)}</span>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				</>
			)}
		</WorkspacePage>
	);
}

function fmtSigned(n: number): string {
	const r = Math.round(n);
	return r > 0 ? `+${r}` : String(r);
}

function fmtSignedMoney(n: number): string {
	const r = Math.round(n);
	return `${r >= 0 ? "+" : "−"}₹${Math.abs(r).toLocaleString("en-IN")}`;
}

function gotoReservations(from: string, to: string) {
	window.location.hash = `#/reservations?arrival_date_start=${from}&arrival_date_end=${to}`;
}

function KpiCard({
	label,
	value,
	delta,
	deltaLabel,
	onClick,
}: {
	label: string;
	value: string;
	delta: number | null;
	deltaLabel: string;
	onClick: () => void;
}) {
	const up = (delta ?? 0) > 0;
	const flat = (delta ?? 0) === 0 || delta === null;
	return (
		<motion.button
			variants={staggerItem}
			type="button"
			onClick={onClick}
			className="flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:border-brass/40"
		>
			<span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
			<span className="font-display text-2xl font-light tabular-nums">{value}</span>
			<span
				className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
					flat ? "bg-muted text-muted-foreground" : up ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
				}`}
			>
				{!flat ? (up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />) : null}
				{deltaLabel}
			</span>
		</motion.button>
	);
}

function TrendChart({ trend }: { trend: DailyTrend }) {
	const data = trend.series.map((p) => ({
		date: p.date.slice(5), // MM-DD
		room_revenue: p.room_revenue,
		occupancy_pct: p.occupancy_pct,
		present: p.present,
	}));

	return (
		<div className="h-64 w-full">
			<ResponsiveContainer width="100%" height="100%">
				<ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
					<CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
					<XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={24} axisLine={false} tickLine={false} />
					<YAxis yAxisId="rev" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => formatINRCompact(v)} axisLine={false} tickLine={false} width={48} />
					<YAxis yAxisId="occ" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} width={36} />
					<RTooltip
						contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
						labelStyle={{ color: "hsl(var(--foreground))" }}
						formatter={(value: number, name: string) => name === "occupancy_pct" ? [`${Math.round(value)}%`, "Occupancy"] : [formatINR(value), "Room revenue"]}
					/>
					<Bar yAxisId="rev" dataKey="room_revenue" radius={[3, 3, 0, 0]} maxBarSize={22}>
						{data.map((d, i) => (
							<Cell key={i} fill={d.present ? "hsl(var(--brass))" : "hsl(var(--muted-foreground) / 0.25)"} />
						))}
					</Bar>
					<Line yAxisId="occ" type="monotone" dataKey="occupancy_pct" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} />
				</ComposedChart>
			</ResponsiveContainer>
		</div>
	);
}
