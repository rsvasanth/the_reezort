/**
 * Reservations list — rich operational list. Click a row → full reservation workspace.
 * "New booking" → full-page booking flow. (Cancel is the only quick inline action.)
 *
 * Defaults to the active booking pipeline (Draft…Modified). Switch "Show" to
 * "All (incl. checked-in & history)" to see Checked In / Cancelled / Completed /
 * No Show / Expired reservations — those are excluded by default so the front
 * desk board stays focused on what still needs action, but they must remain
 * reachable via search/filter here (2026-07-10 audit fix).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

import { RoomThumb } from "@/components/property/room-thumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
	Modified: "secondary",
	"Checked In": "secondary",
	Completed: "outline",
	Cancelled: "destructive",
	"No Show": "destructive",
	"No Show Pending": "destructive",
	Expired: "destructive",
	Waitlisted: "outline",
};

const PAGE_LENGTH = 25;

export default function ReservationsList() {
	const [rows, setRows] = useState<ReservationRow[]>([]);
	const [totalCount, setTotalCount] = useState(0);
	const [loading, setLoading] = useState(true);
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	const [scope, setScope] = useState<"active" | "all">("active");
	const [page, setPage] = useState(1);
	const [busy, setBusy] = useState<string | null>(null);

	// Debounce the search box → server-side search (spans every reservation,
	// not just whatever page happens to be loaded).
	useEffect(() => {
		const t = setTimeout(() => setSearch(searchInput.trim()), 350);
		return () => clearTimeout(t);
	}, [searchInput]);

	// Any filter change resets to page 1.
	useEffect(() => {
		setPage(1);
	}, [search, scope]);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const result = await listReservations({
				status: scope === "all" ? "all" : undefined,
				search: search || undefined,
				page,
				page_length: PAGE_LENGTH,
			});
			setRows(result.reservations);
			setTotalCount(result.total_count);
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Could not load reservations", { description: detail });
		} finally {
			setLoading(false);
		}
	}, [scope, search, page]);

	useEffect(() => {
		reload();
	}, [reload]);

	const totalPages = Math.max(Math.ceil(totalCount / PAGE_LENGTH), 1);
	const rangeStart = totalCount === 0 ? 0 : (page - 1) * PAGE_LENGTH + 1;
	const rangeEnd = Math.min(page * PAGE_LENGTH, totalCount);

	const kpis = useMemo(
		() => [
			{ label: "Matching", value: totalCount },
			{ label: "This page", value: rows.length },
			{ label: "Page", value: `${page} / ${totalPages}` },
		],
		[totalCount, rows.length, page, totalPages],
	);

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

			<div className="flex flex-wrap items-center gap-2">
				<div className="relative w-72 max-w-full">
					<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
					<Input
						className="pl-8"
						placeholder="Search guest name or reservation code…"
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						data-testid="reservations-search"
					/>
				</div>
				<Select value={scope} onValueChange={(v) => setScope(v as "active" | "all")}>
					<SelectTrigger className="w-64" data-testid="reservations-scope">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="active">Active pipeline (default)</SelectItem>
						<SelectItem value="all">All (incl. checked-in &amp; history)</SelectItem>
					</SelectContent>
				</Select>
				<span className="text-sm text-muted-foreground">
					{totalCount === 0 ? "0 results" : `${rangeStart}–${rangeEnd} of ${totalCount}`}
				</span>
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
						) : rows.length === 0 ? (
							<TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No reservations match.</TableCell></TableRow>
						) : (
							rows.map((r) => (
								<TableRow
									key={r.reservation}
									data-testid={`res-${r.reservation}`}
									className="cursor-pointer"
									onClick={() => go(`#/reservations/${encodeURIComponent(r.reservation)}`)}
								>
									<TableCell className="font-medium">{r.reservation}</TableCell>
									<TableCell>{r.guest}</TableCell>
									<TableCell className="text-sm">
										<div className="flex items-center gap-2">
											<RoomThumb image={r.room_type_image} label={r.room_type ?? "?"} size={32} />
											<span>{r.room_type ?? "—"}</span>
										</div>
									</TableCell>
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

			{totalCount > PAGE_LENGTH ? (
				<div className="flex items-center justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={page <= 1 || loading}
						onClick={() => setPage((p) => Math.max(p - 1, 1))}
						data-testid="reservations-prev-page"
					>
						<ChevronLeft className="size-4" /> Prev
					</Button>
					<span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
					<Button
						variant="outline"
						size="sm"
						disabled={page >= totalPages || loading}
						onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
						data-testid="reservations-next-page"
					>
						Next <ChevronRight className="size-4" />
					</Button>
				</div>
			) : null}
		</WorkspacePage>
	);
}
