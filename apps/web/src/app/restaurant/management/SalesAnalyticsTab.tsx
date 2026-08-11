/**
 * SalesAnalyticsTab — KPI strip, daily sales trend, top dishes, and revenue
 * by waiter for the selected outlet + range. Live-with-mock fallback.
 */

import { useCallback, useEffect, useState } from "react";
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
import { Loader2, RefreshCw, UtensilsCrossed } from "lucide-react";

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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { MenuItemThumb } from "@/components/fnb/menu-visuals";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import { formatINR, formatINRCompact } from "@/lib/analytics-api";
import {
	getDailySales,
	getSalesSummary,
	rangeEndingYesterday,
	salesByWaiter,
	topDishes,
	type DailySales,
	type SalesByWaiter,
	type SalesSummary,
	type TopDishes,
} from "@/lib/restaurant-management-api";

import { DeltaBadge } from "./management-visuals";

type LoadState = "loading" | "live" | "error" | "denied";

const RANGES = [
	{ key: "7", label: "Last 7 days" },
	{ key: "30", label: "Last 30 days" },
	{ key: "90", label: "Last 90 days" },
] as const;

export default function SalesAnalyticsTab({ outlet }: { outlet: string }) {
	const [days, setDays] = useState(30);
	const [summary, setSummary] = useState<SalesSummary | null>(null);
	const [daily, setDaily] = useState<DailySales | null>(null);
	const [waiters, setWaiters] = useState<SalesByWaiter | null>(null);
	const [dishes, setDishes] = useState<TopDishes | null>(null);
	const [state, setState] = useState<LoadState>("loading");

	const load = useCallback(() => {
		setState("loading");
		const range = rangeEndingYesterday(days);
		const params = { ...range, outlet: outlet || undefined };
		Promise.all([
			getSalesSummary(params),
			getDailySales(params),
			salesByWaiter(params),
			topDishes({ ...params, limit: 8 }),
		])
			.then(([s, d, w, t]) => {
				setSummary(s);
				setDaily(d);
				setWaiters(w);
				setDishes(t);
				setState("live");
			})
			.catch((error: unknown) => {
				if (error instanceof FolioApiError && error.status === 403) {
					setState("denied");
					return;
				}
				setState("error");
			});
	}, [days, outlet]);

	useEffect(() => {
		load();
	}, [load]);

	if (state === "loading") {
		return (
			<div className="flex flex-col gap-4" data-testid="sales-loading">
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<Skeleton key={i} className="h-24 rounded-xl" />
					))}
				</div>
				<Skeleton className="h-64 rounded-xl" />
			</div>
		);
	}

	if (state === "denied") {
		return (
			<Card>
				<CardContent className="py-8 text-center text-sm text-muted-foreground">
					You do not have permission to view F&amp;B analytics. Ask a manager.
				</CardContent>
			</Card>
		);
	}

	if (state === "error" || !summary || !daily || !waiters || !dishes) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-center">
				<p className="text-sm text-muted-foreground">Could not load sales analytics.</p>
				<Button variant="outline" onClick={load}>
					<RefreshCw className="mr-1.5 size-4" /> Retry
				</Button>
			</div>
		);
	}

	const empty = summary.total_orders === 0;

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Badge variant="outline">Live</Badge>
					<span className="text-xs text-muted-foreground">
						{summary.from_date} → {summary.to_date}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
						<SelectTrigger className="w-40" data-testid="sales-range">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{RANGES.map((r) => (
								<SelectItem key={r.key} value={r.key}>
									{r.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button variant="outline" size="icon" aria-label="Refresh" onClick={load}>
						<RefreshCw className="size-4" />
					</Button>
				</div>
			</div>

			{empty ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
					<UtensilsCrossed className="size-7 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">No orders in this window.</p>
				</div>
			) : (
				<>
					<motion.div
						className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
						variants={staggerContainer}
						initial="hidden"
						animate="show"
						data-testid="sales-kpis"
					>
						<KpiTile label="Revenue" value={formatINRCompact(summary.revenue)} delta={summary.deltas.revenue_pct} />
						<KpiTile label="Settled orders" value={String(summary.settled_orders)} delta={summary.deltas.orders_pct} />
						<KpiTile label="Avg check" value={formatINR(summary.avg_check)} delta={summary.deltas.avg_check_pct} />
						<KpiTile
							label="Cancel rate"
							value={`${summary.cancel_rate_pct}%`}
							sub={`${summary.cancelled_orders} of ${summary.total_orders}`}
						/>
					</motion.div>

					<Card>
						<CardContent className="p-5">
							<div className="mb-4 flex items-baseline justify-between">
								<h2 className="font-display text-base font-normal">Daily sales</h2>
								<span className="text-[11px] text-muted-foreground">Revenue bars · orders line</span>
							</div>
							<DailyChart daily={daily} />
						</CardContent>
					</Card>

					<div className="grid gap-4 lg:grid-cols-2">
						<Card>
							<CardContent className="p-5">
								<h2 className="mb-3 font-display text-base font-normal">Top dishes</h2>
								{dishes.dishes.length === 0 ? (
									<p className="py-6 text-center text-sm text-muted-foreground">No dishes sold.</p>
								) : (
									<motion.ol
										className="flex flex-col gap-2"
										variants={staggerContainer}
										initial="hidden"
										animate="show"
										data-testid="top-dishes"
									>
										{dishes.dishes.map((d, i) => (
											<motion.li key={d.menu_item} variants={staggerItem} className="flex items-center gap-3">
												<span className="w-5 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
													{i + 1}
												</span>
												<MenuItemThumb src={d.image} category={d.category ?? "Other"} name={d.item_name} size="sm" showVegDot={false} />
												<div className="min-w-0 flex-1">
													<div className="truncate text-sm font-medium">{d.item_name}</div>
													<div className="text-[11px] text-muted-foreground">{d.category ?? "—"}</div>
												</div>
												<div className="shrink-0 text-right">
													<div className="text-sm font-medium tabular-nums">{formatINR(d.revenue)}</div>
													<div className="text-[11px] text-muted-foreground tabular-nums">{d.qty_sold} sold</div>
												</div>
											</motion.li>
										))}
									</motion.ol>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardContent className="p-5">
								<h2 className="mb-3 font-display text-base font-normal">Revenue by waiter</h2>
								{waiters.waiters.length === 0 ? (
									<p className="py-6 text-center text-sm text-muted-foreground">No waiter sales.</p>
								) : (
									<Table data-testid="sales-by-waiter">
										<TableHeader>
											<TableRow>
												<TableHead>Waiter</TableHead>
												<TableHead className="text-right">Orders</TableHead>
												<TableHead className="text-right">Covers</TableHead>
												<TableHead className="text-right">Avg</TableHead>
												<TableHead className="text-right">Revenue</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{waiters.waiters.map((w) => (
												<TableRow key={w.user}>
													<TableCell className="font-medium">{w.waiter_name ?? w.user}</TableCell>
													<TableCell className="text-right tabular-nums">{w.orders}</TableCell>
													<TableCell className="text-right tabular-nums">{w.covers}</TableCell>
													<TableCell className="text-right tabular-nums">{formatINR(w.avg_check)}</TableCell>
													<TableCell className="text-right font-medium tabular-nums">{formatINR(w.revenue)}</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								)}
							</CardContent>
						</Card>
					</div>
				</>
			)}
		</div>
	);
}

function KpiTile({
	label,
	value,
	delta,
	sub,
}: {
	label: string;
	value: string;
	delta?: number | null;
	sub?: string;
}) {
	return (
		<motion.div variants={staggerItem} className="flex flex-col items-start gap-2 rounded-xl border bg-card p-4">
			<span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
			<span className="font-display text-2xl font-light tabular-nums">{value}</span>
			{delta !== undefined ? <DeltaBadge value={delta} /> : sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
		</motion.div>
	);
}

function DailyChart({ daily }: { daily: DailySales }) {
	const data = daily.series.map((p) => ({
		date: p.date.slice(5), // MM-DD
		revenue: p.revenue,
		orders: p.orders,
		present: p.present,
	}));

	return (
		<div className="h-60 w-full">
			<ResponsiveContainer width="100%" height="100%">
				<ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
					<CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
					<XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={24} axisLine={false} tickLine={false} />
					<YAxis yAxisId="rev" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => formatINRCompact(v)} axisLine={false} tickLine={false} width={48} />
					<YAxis yAxisId="ord" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={28} />
					<RTooltip
						contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
						labelStyle={{ color: "hsl(var(--foreground))" }}
						formatter={(value: number, name: string) => (name === "orders" ? [value, "Orders"] : [formatINR(value), "Revenue"])}
					/>
					<Bar yAxisId="rev" dataKey="revenue" radius={[3, 3, 0, 0]} maxBarSize={22}>
						{data.map((d, i) => (
							<Cell key={i} fill={d.present ? "hsl(var(--brass))" : "hsl(var(--muted-foreground) / 0.25)"} />
						))}
					</Bar>
					<Line yAxisId="ord" type="monotone" dataKey="orders" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} />
				</ComposedChart>
			</ResponsiveContainer>
		</div>
	);
}
