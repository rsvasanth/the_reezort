/**
 * Reservation detail — full-page workspace (header card + KPIs + sections).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, CalendarDays, BedDouble, LogIn } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { WorkspacePage, RecordHeader, KpiStrip } from "@/components/workspace/workspace";
import { formatCurrency } from "@/components/folio/folio-format";
import { FolioApiError, cancelReservation, getReservation, type ReservationDetail as Detail } from "@/lib/reservation-api";
import { checkIn } from "@/lib/pms-api";

function go(path: string) {
	window.location.hash = path;
}

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
	Confirmed: "secondary",
	Hold: "outline",
	Cancelled: "destructive",
	"Checked In": "secondary",
};

export default function ReservationDetail({ reservation }: { reservation: string }) {
	const [detail, setDetail] = useState<Detail | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	const reload = useCallback(async () => {
		try {
			setDetail(await getReservation(reservation));
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Could not load reservation", { description: msg });
		} finally {
			setLoading(false);
		}
	}, [reservation]);

	useEffect(() => {
		reload();
	}, [reload]);

	async function doCheckIn() {
		setBusy(true);
		try {
			const result = await checkIn(reservation);
			toast.success("Checked in", { description: `Room ${result.current_room} · folio ${result.folio}` });
			go(`#/folio/${encodeURIComponent(result.folio)}`);
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Check-in failed", { description: msg });
			setBusy(false);
		}
	}

	async function cancel() {
		setBusy(true);
		try {
			await cancelReservation(reservation);
			toast.success("Reservation cancelled");
			await reload();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Could not cancel", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	if (loading) {
		return (
			<WorkspacePage badge="Reservation" title="Reservation" onBack={() => go("#/reservations")}>
				<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>
			</WorkspacePage>
		);
	}
	if (!detail) {
		return (
			<WorkspacePage badge="Reservation" title="Not found" onBack={() => go("#/reservations")}>
				<Card><CardContent className="py-8 text-sm text-muted-foreground">Reservation not found.</CardContent></Card>
			</WorkspacePage>
		);
	}

	const cur = detail.currency ?? "INR";
	const canCheckIn = detail.check_in_ready;
	const canCancel = detail.status !== "Cancelled" && detail.status !== "Checked In";

	return (
		<WorkspacePage badge="Reservation" tag="Booking" title={detail.guest} onBack={() => go("#/reservations")}>
			<RecordHeader
				avatarName={detail.guest}
				title={detail.guest}
				idChip={detail.reservation}
				onCopyId={() => navigator.clipboard?.writeText(detail.reservation)}
				statuses={[{ label: detail.status, variant: STATUS_VARIANT[detail.status] ?? "outline" }]}
				links={[
					...(detail.stay ? [{ label: detail.stay, icon: <BedDouble className="size-3.5" /> }] : []),
					{ label: `${detail.arrival_date ?? "—"} → ${detail.departure_date ?? "—"}`, icon: <CalendarDays className="size-3.5" /> },
				]}
				meta={[
					{ label: "Property", value: detail.resort_property },
					{ label: "Source", value: detail.booking_source ?? "—" },
					{ label: "Currency", value: cur },
				]}
				actions={
					<>
						{canCheckIn ? (
							<Button size="sm" onClick={doCheckIn} disabled={busy} data-testid="res-checkin">
								{busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Check in
							</Button>
						) : null}
						{canCancel ? (
							<Button size="sm" variant="outline" onClick={cancel} disabled={busy}>Cancel reservation</Button>
						) : null}
					</>
				}
			/>

			<KpiStrip
				items={[
					{ label: "Nights", value: detail.nights ?? "—" },
					{ label: "Rooms", value: detail.rooms.length },
					{ label: "Estimated", value: formatCurrency(detail.total_estimated_amount ?? 0, cur) },
					{ label: "Deposit", value: detail.deposit_status ?? "—" },
				]}
			/>

			<Card>
				<CardContent className="flex flex-col gap-3 p-6">
					<h3 className="text-sm font-semibold">Rooms</h3>
					<div className="rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Room type</TableHead>
									<TableHead>Adults</TableHead>
									<TableHead>Children</TableHead>
									<TableHead className="text-right">Estimated</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{detail.rooms.map((r, i) => (
									<TableRow key={i}>
										<TableCell className="font-medium">{r.room_type}</TableCell>
										<TableCell>{r.adults}</TableCell>
										<TableCell>{r.children}</TableCell>
										<TableCell className="text-right">{formatCurrency(r.estimated_amount ?? 0, cur)}</TableCell>
										<TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			{detail.guests.length ? (
				<Card>
					<CardContent className="flex flex-col gap-3 p-6">
						<h3 className="text-sm font-semibold">Guests</h3>
						<div className="flex flex-col gap-2">
							{detail.guests.map((g, i) => (
								<div key={i} className="flex flex-wrap items-center gap-3 text-sm">
									<span className="font-medium">{g.guest_name}</span>
									{g.is_primary_guest ? <Badge variant="outline">Primary</Badge> : null}
									{g.email ? <span className="text-muted-foreground">{g.email}</span> : null}
									{g.phone ? <span className="text-muted-foreground">{g.phone}</span> : null}
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			) : null}
		</WorkspacePage>
	);
}
