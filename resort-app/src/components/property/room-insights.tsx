/**
 * RoomInsights — hero image + gallery strip + business KPI cards.
 * Replaces the "useless form" landing on the Room workspace Overview tab.
 *
 * Data source: property.insights_api.get_room_insights(room). Photos come
 * from the 3D-render seed (image_seed.py) attached as Files to the Room.
 */

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
	BedDouble, Brush, Calendar,
	Clock, IndianRupee, ListChecks, Loader2, Percent, User,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { getRoomInsights, type RoomInsights } from "@/lib/timeline-api";
import { RoomGallery } from "@/components/property/room-gallery";

function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function RoomInsightsPanel({ room }: { room: string }) {
	const [insights, setInsights] = useState<RoomInsights | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		getRoomInsights(room)
			.then((res) => { if (alive) setInsights(res); })
			.catch(() => { if (alive) setInsights(null); })
			.finally(() => { if (alive) setLoading(false); });
		return () => { alive = false; };
	}, [room]);

	if (loading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading insights…
			</div>
		);
	}

	if (!insights) {
		return (
			<Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
				Insights unavailable.
			</CardContent></Card>
		);
	}

	const gallery = insights.gallery;

	return (
		<motion.div
			className="flex flex-col gap-6"
			variants={staggerContainer}
			initial="hidden"
			animate="show"
			data-testid="room-insights"
		>
			{/* Bento gallery tiles + lightbox */}
			<motion.section variants={staggerItem}>
				<RoomGallery items={gallery} roomLabel={insights.room} />
			</motion.section>

			{/* KPI grid */}
			<motion.section variants={staggerItem} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<KpiCard
					icon={Percent}
					label="Occupancy (30d)"
					value={`${insights.occupancy_pct_30d}%`}
					sub={`${insights.occupied_nights_30d} / 30 nights`}
				/>
				<KpiCard
					icon={IndianRupee}
					label="Revenue (30d)"
					value={formatINR(insights.revenue_30d)}
					sub={insights.revenue_30d === 0 ? "No paid stays yet" : "From folio payments"}
				/>
				<KpiCard
					icon={ListChecks}
					label="Open tasks"
					value={String(insights.tasks.open_count)}
					sub={insights.tasks.high_priority_open > 0 ? `${insights.tasks.high_priority_open} high priority` : "No high-priority items"}
					accent={insights.tasks.high_priority_open > 0 ? "warn" : undefined}
				/>
				<KpiCard
					icon={Brush}
					label="Last cleaned"
					value={insights.tasks.last_cleaned_at ? formatDate(insights.tasks.last_cleaned_at) : "—"}
					sub={insights.tasks.last_clean_type ?? "No cleaning logged"}
				/>
			</motion.section>

			{/* Current guest + Upcoming */}
			<motion.section variants={staggerItem} className="grid gap-3 md:grid-cols-2">
				<Card>
					<CardContent className="flex flex-col gap-2 py-4">
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<User className="size-3.5" /> In house now
						</div>
						{insights.current ? (
							<>
								<div className="text-base font-medium">{insights.current.guest_name ?? "Guest"}</div>
								<div className="text-xs text-muted-foreground">
									{formatDate(insights.current.arrival_date)} → {formatDate(insights.current.departure_date)}
									{insights.current.nights_remaining !== null ? ` · ${insights.current.nights_remaining} night${insights.current.nights_remaining === 1 ? "" : "s"} left` : ""}
								</div>
								<a
									href={`#/folio/${encodeURIComponent(insights.current.stay)}`}
									className="mt-1 text-xs text-primary hover:underline"
								>
									Open stay {insights.current.stay}
								</a>
							</>
						) : (
							<>
								<div className="text-sm text-muted-foreground">No current guest</div>
								{insights.days_since_last_stay !== null ? (
									<div className="text-xs text-muted-foreground">
										Vacant since {insights.days_since_last_stay} day{insights.days_since_last_stay === 1 ? "" : "s"}
									</div>
								) : null}
							</>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardContent className="flex flex-col gap-2 py-4">
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<Calendar className="size-3.5" /> Upcoming reservations
						</div>
						{insights.upcoming.length === 0 ? (
							<div className="text-sm text-muted-foreground">Nothing booked for this room yet.</div>
						) : (
							<ul className="flex flex-col gap-1.5">
								{insights.upcoming.map((r) => (
									<li key={r.name} className="flex items-center justify-between rounded-md bg-accent/30 px-2 py-1.5 text-xs">
										<div>
											<div className="font-medium">{r.guest_name ?? r.name}</div>
											<div className="text-[11px] text-muted-foreground">
												{formatDate(r.arrival_date)} → {formatDate(r.departure_date)}
											</div>
										</div>
										<Badge variant="outline" className="text-[10px]">{r.status}</Badge>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			</motion.section>

			{/* Equipment condition roll-up */}
			<motion.section variants={staggerItem}>
				<Card>
					<CardContent className="flex flex-col gap-2 py-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<BedDouble className="size-3.5" /> Equipment condition
							</div>
							<span className="text-xs text-muted-foreground">{insights.equipment.total} total</span>
						</div>
						{insights.equipment.total === 0 ? (
							<div className="text-sm text-muted-foreground">No equipment tracked. Add WiFi, TV, AC on the Equipment tab.</div>
						) : (
							<div className="flex flex-wrap gap-2">
								{Object.entries(insights.equipment.by_condition).map(([cond, count]) => (
									<Badge
										key={cond}
										variant={cond === "Working" ? "secondary" : "outline"}
										className={cond === "Working" ? "" : "border-[#b28600] text-[#684e00]"}
									>
										{cond} · {count}
									</Badge>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</motion.section>
		</motion.div>
	);
}

function KpiCard({
	icon: Icon,
	label,
	value,
	sub,
	accent,
}: {
	icon: typeof Clock;
	label: string;
	value: string;
	sub?: string;
	accent?: "warn";
}) {
	return (
		<Card>
			<CardContent className="flex flex-col gap-1 py-4">
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Icon className="size-3.5" /> {label}
				</div>
				<div className={`text-2xl font-light ${accent === "warn" ? "text-[#684e00]" : "text-foreground"}`}>{value}</div>
				{sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
			</CardContent>
		</Card>
	);
}
