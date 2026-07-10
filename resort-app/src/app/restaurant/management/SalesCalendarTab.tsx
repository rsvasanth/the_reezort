/**
 * SalesCalendarTab — a month grid of settled revenue, orders, the day's top
 * dish, and wastage value, with month navigation and a totals strip.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import { formatINR, formatINRCompact } from "@/lib/analytics-api";
import {
	getSalesCalendar,
	mockCalendar,
	type SalesCalendar,
} from "@/lib/restaurant-management-api";

type LoadState = "loading" | "live" | "mock" | "error" | "denied";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SalesCalendarTab({ outlet }: { outlet: string }) {
	const now = new Date();
	const [year, setYear] = useState(now.getFullYear());
	const [month, setMonth] = useState(now.getMonth() + 1); // 1-based
	const [cal, setCal] = useState<SalesCalendar | null>(null);
	const [state, setState] = useState<LoadState>("loading");

	const load = useCallback(() => {
		setState("loading");
		getSalesCalendar({ year, month, outlet: outlet || undefined })
			.then((c) => {
				setCal(c);
				setState("live");
			})
			.catch((error: unknown) => {
				if (error instanceof FolioApiError && error.status === 403) {
					setState("denied");
					return;
				}
				if (error instanceof FolioApiError && error.status >= 400 && error.status < 500) {
					setState("error");
					return;
				}
				setCal(mockCalendar(year, month));
				setState("mock");
			});
	}, [year, month, outlet]);

	useEffect(() => {
		load();
	}, [load]);

	function step(delta: number) {
		const m0 = month - 1 + delta;
		const y = year + Math.floor(m0 / 12);
		const m = ((m0 % 12) + 12) % 12;
		setYear(y);
		setMonth(m + 1);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" aria-label="Previous month" onClick={() => step(-1)}>
						<ChevronLeft className="size-4" />
					</Button>
					<span className="min-w-40 text-center font-display text-lg font-normal tabular-nums" data-testid="calendar-month">
						{MONTHS[month - 1]} {year}
					</span>
					<Button variant="outline" size="icon" aria-label="Next month" onClick={() => step(1)}>
						<ChevronRight className="size-4" />
					</Button>
					{state === "mock" ? <Badge variant="outline">Mock</Badge> : null}
				</div>
				{cal ? (
					<div className="flex items-center gap-4 text-sm">
						<span className="text-muted-foreground">
							Revenue <span className="font-medium text-foreground tabular-nums">{formatINR(cal.totals.revenue)}</span>
						</span>
						<span className="text-muted-foreground">
							Orders <span className="font-medium text-foreground tabular-nums">{cal.totals.orders}</span>
						</span>
						{cal.totals.waste_value > 0 ? (
							<span className="inline-flex items-center gap-1 text-[#8e6a00] dark:text-[#d2a106]">
								<Trash2 className="size-3.5" /> <span className="tabular-nums">{formatINR(cal.totals.waste_value)}</span>
							</span>
						) : null}
					</div>
				) : null}
			</div>

			{state === "loading" ? (
				<div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading calendar…
				</div>
			) : state === "denied" ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						You do not have permission to view F&amp;B analytics. Ask a manager.
					</CardContent>
				</Card>
			) : state === "error" || !cal ? (
				<div className="flex flex-col items-center gap-3 py-16 text-center">
					<p className="text-sm text-muted-foreground">Could not load the sales calendar.</p>
					<Button variant="outline" onClick={load}>
						<RefreshCw className="mr-1.5 size-4" /> Retry
					</Button>
				</div>
			) : (
				<CalendarGrid cal={cal} />
			)}
		</div>
	);
}

function CalendarGrid({ cal }: { cal: SalesCalendar }) {
	const maxRevenue = Math.max(1, ...cal.days.map((d) => d.revenue));
	const lead = cal.days.length ? cal.days[0].day_of_week - 1 : 0; // Mon-based offset

	return (
		<TooltipProvider delayDuration={100}>
			<div>
				<div className="mb-1 grid grid-cols-7 gap-1.5">
					{WEEKDAYS.map((w) => (
						<div key={w} className="px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
							{w}
						</div>
					))}
				</div>
				<motion.div
				className="grid grid-cols-7 gap-1.5"
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				data-testid="calendar-grid"
			>
				{Array.from({ length: lead }).map((_, i) => (
					<div key={`lead-${i}`} />
				))}
				{cal.days.map((d) => {
					const dayNum = Number(d.date.slice(8, 10));
					const intensity = d.revenue > 0 ? 0.08 + 0.32 * (d.revenue / maxRevenue) : 0;
					return (
						<motion.div
							key={d.date}
							variants={staggerItem}
							className="flex min-h-24 flex-col rounded-lg border p-1.5"
							style={{ background: intensity > 0 ? `hsl(var(--brass) / ${intensity})` : undefined }}
							data-testid={`calendar-day-${d.date}`}
						>
							<div className="flex items-center justify-between">
								<span className="text-xs font-medium tabular-nums">{dayNum}</span>
								{d.waste_value > 0 ? (
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="inline-flex items-center text-[#8e6a00] dark:text-[#d2a106]">
												<Trash2 className="size-3" />
											</span>
										</TooltipTrigger>
										<TooltipContent>Wastage {formatINR(d.waste_value)}</TooltipContent>
									</Tooltip>
								) : null}
							</div>
							{d.orders > 0 ? (
								<div className="mt-auto">
									<div className="text-sm font-medium tabular-nums">{formatINRCompact(d.revenue)}</div>
									<div className="text-[10px] text-muted-foreground tabular-nums">{d.orders} ord</div>
									{d.top_dish ? (
										<div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={d.top_dish.item_name}>
											★ {d.top_dish.item_name}
										</div>
									) : null}
								</div>
							) : (
								<div className="mt-auto text-[10px] text-muted-foreground/50">—</div>
							)}
						</motion.div>
						);
					})}
				</motion.div>
			</div>
		</TooltipProvider>
	);
}
