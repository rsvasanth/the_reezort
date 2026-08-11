/**
 * DishPerformanceTab — per-dish velocity, revenue, gross margin, and a trend
 * arrow (qty this window vs the prior one), plus a slow-mover list of
 * available dishes that didn't sell at all.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Snowflake } from "lucide-react";

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
import { FolioApiError } from "@/lib/folio-api";
import { formatINR } from "@/lib/analytics-api";
import {
	getDishPerformance,
	rangeEndingYesterday,
	type DishPerformance,
} from "@/lib/restaurant-management-api";

import { TrendArrow } from "./management-visuals";

type LoadState = "loading" | "live" | "error" | "denied";

const RANGES = [
	{ key: "7", label: "Last 7 days" },
	{ key: "30", label: "Last 30 days" },
	{ key: "90", label: "Last 90 days" },
] as const;

function marginTint(pct: number): string {
	if (pct >= 60) return "text-success";
	if (pct >= 35) return "text-foreground";
	return "text-destructive";
}

export default function DishPerformanceTab({ outlet }: { outlet: string }) {
	const [days, setDays] = useState(30);
	const [perf, setPerf] = useState<DishPerformance | null>(null);
	const [state, setState] = useState<LoadState>("loading");

	const load = useCallback(() => {
		setState("loading");
		const range = rangeEndingYesterday(days);
		getDishPerformance({ ...range, outlet: outlet || undefined })
			.then((p) => {
				setPerf(p);
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

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Badge variant="outline">Live</Badge>
					<span className="text-xs text-muted-foreground">Margin uses the dish BOM cost</span>
				</div>
				<div className="flex items-center gap-2">
					<Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
						<SelectTrigger className="w-40" data-testid="dishes-range">
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

			{state === "loading" ? (
				<Skeleton className="h-72 rounded-xl" data-testid="dishes-loading" />
			) : state === "denied" ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						You do not have permission to view F&amp;B analytics. Ask a manager.
					</CardContent>
				</Card>
			) : state === "error" || !perf ? (
				<div className="flex flex-col items-center gap-3 py-16 text-center">
					<p className="text-sm text-muted-foreground">Could not load dish performance.</p>
					<Button variant="outline" onClick={load}>
						<RefreshCw className="mr-1.5 size-4" /> Retry
					</Button>
				</div>
			) : perf.dishes.length === 0 ? (
				<div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
					No dishes sold in this window.
				</div>
			) : (
				<>
					<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
						<Table data-testid="dish-performance">
							<TableHeader>
								<TableRow>
									<TableHead>Dish</TableHead>
									<TableHead className="text-right">Sold</TableHead>
									<TableHead className="text-right">Revenue</TableHead>
									<TableHead className="text-right">Gross margin</TableHead>
									<TableHead className="text-right">Trend</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{perf.dishes.map((d) => (
									<TableRow key={d.menu_item} data-testid={`dish-${d.menu_item}`}>
										<TableCell>
											<div className="flex items-center gap-3">
												<MenuItemThumb src={d.image} category={d.category ?? "Other"} name={d.item_name} size="sm" showVegDot={false} />
												<div className="min-w-0">
													<div className="truncate font-medium">{d.item_name}</div>
													<div className="text-[11px] text-muted-foreground">{d.category ?? "—"}</div>
												</div>
											</div>
										</TableCell>
										<TableCell className="text-right tabular-nums">{d.qty_sold}</TableCell>
										<TableCell className="text-right tabular-nums">{formatINR(d.revenue)}</TableCell>
										<TableCell className={`text-right tabular-nums ${marginTint(d.gross_margin_pct)}`}>
											<div className="font-medium">{d.gross_margin_pct}%</div>
											<div className="text-[11px] text-muted-foreground">{formatINR(d.gross_margin)}</div>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end">
												<TrendArrow trend={d.trend} deltaPct={d.delta_pct} />
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>

					{perf.slow_movers.length > 0 ? (
						<Card>
							<CardContent className="p-5">
								<h2 className="mb-1 flex items-center gap-2 font-display text-base font-normal">
									<Snowflake className="size-4 text-primary" /> Slow movers
								</h2>
								<p className="mb-3 text-[11px] text-muted-foreground">
									Available dishes with no sales in this window.
								</p>
								<div className="flex flex-wrap gap-2" data-testid="slow-movers">
									{perf.slow_movers.map((m) => (
										<span key={m.menu_item} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs">
											<MenuItemThumb src={m.image} category={m.category ?? "Other"} name={m.item_name} size="sm" rounded="rounded-full" showVegDot={false} className="!size-6" />
											{m.item_name}
											<span className="text-muted-foreground tabular-nums">{formatINR(m.unit_price)}</span>
										</span>
									))}
								</div>
							</CardContent>
						</Card>
					) : null}
				</>
			)}
		</div>
	);
}
