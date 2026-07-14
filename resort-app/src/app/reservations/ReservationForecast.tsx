/**
 * Reservation forecast — forward-looking arrivals + estimated revenue per day,
 * plus a deposit-pending follow-up list. Read-only management report (spec 002).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, CalendarClock } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WorkspacePage, KpiStrip } from "@/components/workspace/workspace";
import { formatCurrency } from "@/components/folio/folio-format";
import { FolioApiError, getReservationForecast, type ReservationForecast } from "@/lib/reservation-api";

const WINDOWS = [7, 14, 30];

function go(path: string) {
	window.location.hash = path;
}

export default function ReservationForecastScreen() {
	const [data, setData] = useState<ReservationForecast | null>(null);
	const [days, setDays] = useState(14);
	const [loading, setLoading] = useState(true);

	const reload = useCallback(async (window: number) => {
		setLoading(true);
		try {
			const res = await getReservationForecast({ days: window });
			setData(res);
		} catch (error) {
			toast.error("Could not load forecast", {
				description: error instanceof FolioApiError ? error.message : String(error),
			});
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload(days);
	}, [reload, days]);

	return (
		<WorkspacePage
			badge="Reservation"
			tag="Report"
			title="Arrival & deposit forecast"
			onBack={() => go("#/reservations")}
			action={
				<div className="flex items-center gap-1.5">
					{WINDOWS.map((w) => (
						<Button key={w} size="sm" variant={days === w ? "default" : "outline"} onClick={() => setDays(w)}>
							{w}d
						</Button>
					))}
				</div>
			}
		>
			{loading || !data ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : (
				<>
					<KpiStrip
						items={[
							{ label: "Arrivals", value: data.totals.arrivals },
							{ label: "Room nights", value: data.totals.rooms },
							{ label: "Est. revenue", value: formatCurrency(data.totals.revenue, "INR") },
							{
								label: "Deposit pending",
								value: data.totals.deposit_pending,
								accent: data.totals.deposit_pending > 0 ? "danger" : undefined,
							},
						]}
					/>

					<Card>
						<CardContent className="flex flex-col gap-3 p-6">
							<h3 className="flex items-center gap-2 text-sm font-semibold">
								<CalendarClock className="size-4" /> Daily arrivals · {data.start_date} → {data.end_date}
							</h3>
							<div className="rounded-lg border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Date</TableHead>
											<TableHead className="text-right">Arrivals</TableHead>
											<TableHead className="text-right">Rooms</TableHead>
											<TableHead className="text-right">Est. revenue</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.forecast.map((d) => (
											<TableRow key={d.date} className={d.arrivals === 0 ? "text-muted-foreground" : ""}>
												<TableCell className="font-medium">{d.date}</TableCell>
												<TableCell className="text-right tabular-nums">{d.arrivals}</TableCell>
												<TableCell className="text-right tabular-nums">{d.rooms}</TableCell>
												<TableCell className="text-right tabular-nums">{formatCurrency(d.revenue, "INR")}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardContent className="flex flex-col gap-3 p-6">
							<h3 className="text-sm font-semibold">
								Deposit follow-up <Badge variant="secondary">{data.deposit_follow_up.length}</Badge>
							</h3>
							<div className="rounded-lg border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Guest</TableHead>
											<TableHead>Arrival</TableHead>
											<TableHead>Deposit</TableHead>
											<TableHead className="text-right">Estimated</TableHead>
											<TableHead className="text-right">Open</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.deposit_follow_up.length === 0 ? (
											<TableRow>
												<TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
													No deposits pending in this window.
												</TableCell>
											</TableRow>
										) : (
											data.deposit_follow_up.map((r) => (
												<TableRow key={r.reservation}>
													<TableCell className="font-medium">{r.guest}</TableCell>
													<TableCell className="text-sm">{r.arrival_date ?? "—"}</TableCell>
													<TableCell>
														<Badge variant="outline">{r.deposit_status}</Badge>
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{formatCurrency(r.total_estimated_amount, "INR")}
													</TableCell>
													<TableCell className="text-right">
														<Button
															size="sm"
															variant="outline"
															onClick={() => go(`#/reservations/${encodeURIComponent(r.reservation)}`)}
														>
															Open
														</Button>
													</TableCell>
												</TableRow>
											))
										)}
									</TableBody>
								</Table>
							</div>
						</CardContent>
					</Card>
				</>
			)}
		</WorkspacePage>
	);
}
