/**
 * Reservations list — rich operational list. Click a row → full reservation workspace.
 * "New booking" → full-page booking flow. (Cancel is the only quick inline action.)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { WorkspacePage, KpiStrip } from "@/components/workspace/workspace";
import {
	FolioApiError,
	cancelReservation,
	listReservations,
	type ReservationRow,
} from "@/lib/reservation-api";

function go(path: string) {
	window.location.hash = path;
}

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
	Confirmed: "secondary",
	Hold: "outline",
	Quoted: "outline",
	"Deposit Pending": "outline",
	Cancelled: "destructive",
};

export default function ReservationsList() {
	const [rows, setRows] = useState<ReservationRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setRows((await listReservations()).reservations);
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Could not load reservations", { description: detail });
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter((r) => `${r.guest} ${r.reservation} ${r.room_type ?? ""}`.toLowerCase().includes(q));
	}, [rows, query]);

	const kpis = useMemo(() => {
		const by = (s: string) => rows.filter((r) => r.status === s).length;
		return [
			{ label: "Total", value: rows.length },
			{ label: "Confirmed", value: by("Confirmed") },
			{ label: "On hold", value: by("Hold") },
			{ label: "Quoted", value: by("Quoted") },
		];
	}, [rows]);

	async function cancel(reservation: string) {
		setBusy(reservation);
		try {
			await cancelReservation(reservation);
			toast.success("Reservation cancelled");
			await reload();
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Could not cancel", { description: detail });
		} finally {
			setBusy(null);
		}
	}

	return (
		<WorkspacePage
			badge="Reservations"
			title="Reservations"
			subtitle="Booking pipeline — confirmed bookings appear at the front desk."
			actions={
				<Button onClick={() => go("#/reservations/new")} data-testid="new-booking">
					<Plus className="size-4" /> New booking
				</Button>
			}
		>
			<KpiStrip items={kpis} />

			<div className="flex items-center gap-2">
				<div className="relative w-72 max-w-full">
					<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
					<Input
						className="pl-8"
						placeholder="Search guest, code, room type…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>
				<span className="text-sm text-muted-foreground">{filtered.length} of {rows.length}</span>
			</div>

			<div className="rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Reservation</TableHead>
							<TableHead>Guest</TableHead>
							<TableHead>Room type</TableHead>
							<TableHead>Arrival</TableHead>
							<TableHead>Departure</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Quick</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading ? (
							<TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto size-4 animate-spin" /></TableCell></TableRow>
						) : filtered.length === 0 ? (
							<TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No reservations.</TableCell></TableRow>
						) : (
							filtered.map((r) => (
								<TableRow
									key={r.reservation}
									data-testid={`res-${r.reservation}`}
									className="cursor-pointer"
									onClick={() => go(`#/reservations/${encodeURIComponent(r.reservation)}`)}
								>
									<TableCell className="font-medium">{r.reservation}</TableCell>
									<TableCell>{r.guest}</TableCell>
									<TableCell className="text-sm">{r.room_type ?? "—"}</TableCell>
									<TableCell className="text-sm">{r.arrival_date ?? "—"}</TableCell>
									<TableCell className="text-sm">{r.departure_date ?? "—"}</TableCell>
									<TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
									<TableCell className="text-right">
										{r.status !== "Cancelled" && r.status !== "Checked In" ? (
											<Button
												variant="ghost"
												size="icon"
												aria-label="Cancel"
												disabled={busy === r.reservation}
												onClick={(e) => {
													e.stopPropagation();
													cancel(r.reservation);
												}}
											>
												<X className="size-4 text-destructive" />
											</Button>
										) : null}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</WorkspacePage>
	);
}
