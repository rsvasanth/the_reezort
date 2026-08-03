/**
 * OccupancyTimeline — CSS-grid Gantt of villas × days over a rolling window.
 * Reservation blocks stretch across the days they span; open housekeeping
 * tasks show as small chips pinned to the day. Click a block → open detail.
 */

import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { getOccupancyTimeline, type OccupancyTimeline } from "@/lib/reservation-api";

// Reservation states on semantic tokens rather than literal hexes. The old map
// hard-coded the Carbon v11 categorical palette, which broke rule 2 of the
// design system (no hard-coded colour) and needed a `dark:` override on every
// entry. The tokens already carry their own dark values, so the overrides go
// away: `text-warning` is the readable dark amber in light mode and the lighter
// one in dark mode, from the same class.
const RES_COLOR: Record<string, { bg: string; text: string; border: string; label: string }> = {
	Hold: { bg: "bg-warning/15", text: "text-warning", border: "border-warning/40", label: "Hold" },
	"Deposit Pending": { bg: "bg-warning/25", text: "text-warning", border: "border-warning/50", label: "Dep Pending" },
	Confirmed: { bg: "bg-primary/15", text: "text-primary", border: "border-primary/40", label: "Confirmed" },
	Modified: { bg: "bg-primary/15", text: "text-primary", border: "border-primary/40", label: "Modified" },
	"Checked In": { bg: "bg-success/20", text: "text-success", border: "border-success/40", label: "In-house" },
	Completed: { bg: "bg-muted", text: "text-muted-foreground", border: "border-border", label: "Completed" },
};

// Task types are categorical, not status — they carry no good/bad meaning — so
// they take the chart series. Differentiation is by background only, with text
// left on `foreground`, because several series are light enough that using them
// as text colour would fail contrast on ivory.
const TASK_COLOR: Record<string, string> = {
	"Departure Cleaning": "bg-chart-4/25 text-foreground",
	"Stayover Cleaning": "bg-chart-3/40 text-foreground",
	"Maintenance Follow-up": "bg-chart-2/25 text-foreground",
	"Arrival Touch-up": "bg-chart-1/25 text-foreground",
};
const DEFAULT_TASK_COLOR = "bg-muted text-muted-foreground";

function addDaysIso(iso: string, days: number): string {
	const d = new Date(iso + "T00:00:00");
	d.setDate(d.getDate() + days);
	return d.toISOString().slice(0, 10);
}

function dayIndex(iso: string, days: string[]): number {
	return days.indexOf(iso);
}

function daysBetween(a: string, b: string): number {
	const d1 = new Date(a + "T00:00:00").getTime();
	const d2 = new Date(b + "T00:00:00").getTime();
	return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function shortDayLabel(iso: string): { dow: string; dm: string } {
	const d = new Date(iso + "T00:00:00");
	return {
		dow: d.toLocaleDateString(undefined, { weekday: "short" }),
		dm: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
	};
}

export function OccupancyTimeline() {
	const [start, setStart] = useState<string>(() => new Date().toISOString().slice(0, 10));
	const [windowDays, setWindowDays] = useState(14);
	const [data, setData] = useState<OccupancyTimeline | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setLoading(true);
		getOccupancyTimeline({ start_date: start, days: windowDays })
			.then(setData)
			.catch(() => setData(null))
			.finally(() => setLoading(false));
	}, [start, windowDays]);

	function shift(delta: number) {
		setStart((s) => addDaysIso(s, delta));
	}

	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<CalendarDays className="size-4 text-muted-foreground" />
					<h2 className="text-sm font-semibold">Occupancy timeline</h2>
					<span className="text-xs text-muted-foreground">{data ? `${data.rooms.length} villas × ${windowDays} days` : ""}</span>
				</div>
				<div className="flex items-center gap-1">
					<Button size="sm" variant="ghost" onClick={() => shift(-7)}><ChevronLeft className="size-4" /> Week</Button>
					<Button size="sm" variant="outline" onClick={() => setStart(new Date().toISOString().slice(0, 10))}>Today</Button>
					<Button size="sm" variant="ghost" onClick={() => shift(7)}>Week <ChevronRight className="size-4" /></Button>
					<div className="ml-3 flex items-center gap-1 text-xs text-muted-foreground">
						{[7, 14, 30].map((d) => (
							<Button key={d} size="sm" variant={windowDays === d ? "default" : "ghost"} onClick={() => setWindowDays(d)}>{d}d</Button>
						))}
					</div>
				</div>
			</div>

			<Card>
				<CardContent className="p-3">
					{loading ? (
						<div className="flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
					) : !data ? (
						<p className="py-8 text-center text-sm text-muted-foreground">Could not load timeline.</p>
					) : (
						<TimelineGrid data={data} />
					)}
					<Legend />
				</CardContent>
			</Card>
		</section>
	);
}

function TimelineGrid({ data }: { data: OccupancyTimeline }) {
	const { rooms, days, reservations, tasks } = data;

	// Map room name → row index for positioning.
	const roomIndex = new Map(rooms.map((r, i) => [r.name, i]));
	const columns = days.length;
	// Use CSS grid: header row + one row per villa. First column = room label.
	const gridTemplateCols = `160px repeat(${columns}, minmax(60px, 1fr))`;

	return (
		<TooltipProvider delayDuration={100}>
			<div className="overflow-x-auto">
				<div className="min-w-[720px]">
					{/* Header */}
					<div className="grid gap-px bg-border" style={{ gridTemplateColumns: gridTemplateCols }}>
						<div className="bg-background p-2 text-xs font-medium text-muted-foreground">Villa</div>
						{days.map((iso) => {
							const { dow, dm } = shortDayLabel(iso);
							const isWeekend = ["Sat", "Sun"].includes(dow);
							return (
								<div key={iso} className={`bg-background p-2 text-center text-[10px] ${isWeekend ? "text-[#684e00] dark:text-[#fddc69]" : "text-muted-foreground"}`}>
									<div className="font-semibold">{dow}</div>
									<div>{dm}</div>
								</div>
							);
						})}
					</div>

					{/* Rows */}
					<div className="grid gap-px bg-border">
						{rooms.map((room) => (
							<div
								key={room.name}
								className="relative grid gap-px bg-border"
								style={{ gridTemplateColumns: gridTemplateCols }}
							>
								<div className="bg-background p-2 text-xs">
									<div className="font-semibold">{room.room_name ?? room.room_number}</div>
									<div className="text-[10px] text-muted-foreground">{room.room_number}</div>
								</div>
								{days.map((iso, i) => {
									const isWeekend = ["Sat", "Sun"].includes(shortDayLabel(iso).dow);
									return <div key={iso} className={`min-h-[52px] bg-background ${isWeekend ? "opacity-95" : ""}`} data-day={iso} data-room={room.name} />;
								})}

								{/* Reservation bars for this room */}
								{reservations.filter((r) => r.room === room.name).map((r) => {
									const arrival = r.arrival_date;
									const departure = r.departure_date;
									const startCol = Math.max(dayIndex(arrival, days), 0);
									// Departure day is checkout — draw up to (but not including) it visually.
									const endCol = Math.min(dayIndex(departure, days), days.length);
									if (endCol <= 0 || startCol >= days.length) return null;
									const clampedStart = Math.max(startCol, 0);
									const clampedEnd = endCol < 0 ? days.length : endCol;
									if (clampedEnd <= clampedStart) return null;
									const color = RES_COLOR[r.status] ?? RES_COLOR.Confirmed;
									return (
										<Tooltip key={r.name}>
											<TooltipTrigger asChild>
												<button
													type="button"
													onClick={() => { window.location.hash = `#/reservations/${encodeURIComponent(r.name)}`; }}
													className={`absolute top-1 flex h-[48px] items-center gap-1 overflow-hidden rounded-md border ${color.bg} ${color.text} ${color.border} px-2 text-left text-xs shadow-sm transition-transform hover:z-10 hover:scale-[1.02]`}
													style={{
														left: `calc(160px + ((100% - 160px) / ${columns}) * ${clampedStart} + 2px)`,
														width: `calc(((100% - 160px) / ${columns}) * ${clampedEnd - clampedStart} - 4px)`,
													}}
													data-testid={`res-block-${r.name}`}
												>
													<span className="truncate font-medium">{r.guest}</span>
													<Badge variant="outline" className="ml-auto shrink-0 text-[10px]">{color.label}</Badge>
												</button>
											</TooltipTrigger>
											<TooltipContent side="top" className="text-xs">
												<div className="font-medium">{r.guest}</div>
												<div>{r.name}</div>
												<div>{r.arrival_date} → {r.departure_date} · {r.nights} night{r.nights === 1 ? "" : "s"}</div>
												<div>Status: {r.status}</div>
											</TooltipContent>
										</Tooltip>
									);
								})}

								{/* Task chips for this room (pinned to due_at day, or today if none) */}
								{tasks.filter((t) => t.room === room.name).map((t) => {
									const iso = (t.due_at ?? t.creation).slice(0, 10);
									const col = dayIndex(iso, days);
									if (col < 0) return null;
									const cls = TASK_COLOR[t.task_type] ?? DEFAULT_TASK_COLOR;
									return (
										<Tooltip key={t.name}>
											<TooltipTrigger asChild>
												<span
													className={`absolute bottom-1 truncate rounded ${cls} px-1.5 py-0.5 text-[10px] font-medium shadow`}
													style={{
														left: `calc(160px + ((100% - 160px) / ${columns}) * ${col} + 2px)`,
														maxWidth: `calc(((100% - 160px) / ${columns}) - 4px)`,
													}}
												>
													{t.task_type.split(" ")[0]}
												</span>
											</TooltipTrigger>
											<TooltipContent side="bottom" className="text-xs">
												<div className="font-medium">{t.task_type}</div>
												<div>Status: {t.task_status} · Priority: {t.priority}</div>
												{t.start_time ? <div>Started: {t.start_time}</div> : null}
												{t.completed_at ? <div>Finished: {t.completed_at}</div> : null}
											</TooltipContent>
										</Tooltip>
									);
								})}
							</div>
						))}
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}

function Legend() {
	return (
		<div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-2 text-[10px] text-muted-foreground">
			<span className="font-medium">Reservations:</span>
			{(["Hold", "Deposit Pending", "Confirmed", "Checked In"] as const).map((s) => {
				const c = RES_COLOR[s];
				return (
					<span key={s} className={`inline-flex items-center gap-1 rounded border ${c.bg} ${c.text} ${c.border} px-1.5 py-0.5`}>
						{c.label}
					</span>
				);
			})}
			<span className="ml-3 font-medium">Tasks:</span>
			{Object.entries(TASK_COLOR).map(([type, cls]) => (
				<span key={type} className={`inline-block rounded ${cls} px-1.5 py-0.5`}>{type}</span>
			))}
		</div>
	);
}
