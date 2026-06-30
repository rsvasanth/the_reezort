/**
 * Reservations — the booking pipeline. List active reservations + a guided
 * booking flow (search availability → select room type → guest → confirm).
 * Confirmed reservations flow to the Front Desk arrivals board.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	FolioApiError,
	cancelReservation,
	confirmReservation,
	createHold,
	listReservations,
	searchAvailability,
	type AvailabilityOffer,
	type ReservationRow,
} from "@/lib/reservation-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function plusDays(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
	Confirmed: "secondary",
	Hold: "outline",
	Quoted: "outline",
	"Deposit Pending": "outline",
	Cancelled: "destructive",
};

export default function ReservationsScreen() {
	const [reservations, setReservations] = useState<ReservationRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [booking, setBooking] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setReservations((await listReservations()).reservations);
		} catch (error) {
			reportError(error, "Could not load reservations");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	async function cancel(reservation: string) {
		setBusy(reservation);
		try {
			await cancelReservation(reservation);
			toast.success("Reservation cancelled");
			await reload();
		} catch (error) {
			reportError(error, "Could not cancel");
		} finally {
			setBusy(null);
		}
	}

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6" data-testid="reservations-screen">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<Badge variant="outline" className="mb-2">Reservations</Badge>
					<h1 className="text-3xl font-light text-foreground md:text-4xl">Reservations</h1>
					<p className="mt-1 text-sm text-muted-foreground">Booking pipeline — confirmed bookings appear at the front desk.</p>
				</div>
				<Button onClick={() => setBooking(true)} data-testid="new-booking">
					<Plus className="size-4" /> New booking
				</Button>
			</header>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : (
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
								<TableHead className="text-right">Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{reservations.length === 0 ? (
								<TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No reservations yet.</TableCell></TableRow>
							) : (
								reservations.map((r) => (
									<TableRow key={r.reservation} data-testid={`res-${r.reservation}`}>
										<TableCell className="font-medium">{r.reservation}</TableCell>
										<TableCell className="text-sm">{r.guest}</TableCell>
										<TableCell className="text-sm">{r.room_type ?? "—"}</TableCell>
										<TableCell className="text-sm">{r.arrival_date ?? "—"}</TableCell>
										<TableCell className="text-sm">{r.departure_date ?? "—"}</TableCell>
										<TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
										<TableCell className="text-right">
											{r.status !== "Cancelled" && r.status !== "Checked In" ? (
												<Button variant="ghost" size="icon" aria-label="Cancel" disabled={busy === r.reservation} onClick={() => cancel(r.reservation)}>
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
			)}

			{booking ? <BookingSheet onClose={() => setBooking(false)} onBooked={reload} /> : null}
		</main>
	);
}

function BookingSheet({ onClose, onBooked }: { onClose: () => void; onBooked: () => void }) {
	const [arrival, setArrival] = useState(plusDays(1));
	const [departure, setDeparture] = useState(plusDays(3));
	const [adults, setAdults] = useState("2");
	const [searching, setSearching] = useState(false);
	const [property, setProperty] = useState<string>("");
	const [offers, setOffers] = useState<AvailabilityOffer[] | null>(null);
	const [roomType, setRoomType] = useState<string>("");
	const [guest, setGuest] = useState({ full_name: "", email: "", phone: "" });
	const [confirming, setConfirming] = useState(false);

	async function doSearch() {
		setSearching(true);
		setOffers(null);
		setRoomType("");
		try {
			const result = await searchAvailability(arrival, departure, parseInt(adults, 10) || 2);
			setProperty(result.property);
			setOffers(result.offers);
			if (result.offers.length === 0) toast.info("No availability for those dates");
		} catch (error) {
			reportError(error, "Availability search failed");
		} finally {
			setSearching(false);
		}
	}

	async function confirm() {
		if (!roomType || !guest.full_name) return;
		setConfirming(true);
		try {
			const hold = await createHold(property, arrival, departure, roomType, parseInt(adults, 10) || 2);
			const result = await confirmReservation(hold.reservation, {
				full_name: guest.full_name,
				email: guest.email || undefined,
				phone: guest.phone || undefined,
			});
			toast.success("Booking confirmed", { description: `${result.reservation} · ${guest.full_name}` });
			onBooked();
			onClose();
		} catch (error) {
			reportError(error, "Could not confirm booking");
		} finally {
			setConfirming(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md" data-testid="booking-sheet">
				<SheetHeader>
					<SheetTitle>New booking</SheetTitle>
					<SheetDescription>Check availability, then confirm with guest details.</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-4 px-4 py-4">
					<div className="grid grid-cols-2 gap-3">
						<Field label="Arrival"><Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} data-testid="b-arrival" /></Field>
						<Field label="Departure"><Input type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} data-testid="b-departure" /></Field>
					</div>
					<div className="grid grid-cols-[1fr_auto] items-end gap-3">
						<Field label="Adults"><Input type="number" min="1" value={adults} onChange={(e) => setAdults(e.target.value)} /></Field>
						<Button variant="outline" onClick={doSearch} disabled={searching} data-testid="b-search">
							{searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Check
						</Button>
					</div>

					{offers ? (
						<div className="flex flex-col gap-2">
							<Label className="text-sm">Available room types</Label>
							{offers.length === 0 ? (
								<p className="text-sm text-muted-foreground">No availability — try other dates.</p>
							) : (
								<div className="flex flex-col gap-1.5" data-testid="offers">
									{offers.map((o) => (
										<button
											key={o.room_type}
											type="button"
											onClick={() => setRoomType(o.room_type)}
											data-testid={`offer-${o.room_type}`}
											className={[
												"flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm",
												roomType === o.room_type ? "border-foreground bg-muted" : "border-border",
											].join(" ")}
										>
											<span>{o.room_type}</span>
											<Badge variant="secondary">{o.available_count} avail</Badge>
										</button>
									))}
								</div>
							)}
						</div>
					) : null}

					{roomType ? (
						<div className="flex flex-col gap-3 border-t pt-3">
							<Label className="text-sm font-medium">Guest details</Label>
							<Field label="Full name"><Input value={guest.full_name} onChange={(e) => setGuest({ ...guest, full_name: e.target.value })} data-testid="b-guest-name" /></Field>
							<div className="grid grid-cols-2 gap-3">
								<Field label="Email"><Input value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /></Field>
								<Field label="Phone"><Input value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} /></Field>
							</div>
						</div>
					) : null}
				</div>

				<SheetFooter>
					<Button onClick={confirm} disabled={confirming || !roomType || !guest.full_name} data-testid="b-confirm">
						{confirming ? <Loader2 className="size-4 animate-spin" /> : null} Confirm booking
					</Button>
					<Button variant="outline" onClick={onClose} disabled={confirming}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			{children}
		</div>
	);
}
