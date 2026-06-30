/**
 * New booking — full-page booking flow: search availability → select room type →
 * guest details → confirm. Dates are validated client-side so search can't 400.
 */

import { useState } from "react";
import { Loader2, Search, BedDouble, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { WorkspacePage } from "@/components/workspace/workspace";
import { formatCurrency } from "@/components/folio/folio-format";
import {
	FolioApiError,
	confirmReservation,
	createHold,
	searchAvailability,
	type AvailabilityOffer,
} from "@/lib/reservation-api";

function go(path: string) {
	window.location.hash = path;
}

function plusDays(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function NewBooking() {
	const [arrival, setArrival] = useState(plusDays(1));
	const [departure, setDeparture] = useState(plusDays(3));
	const [adults, setAdults] = useState("2");
	const [searching, setSearching] = useState(false);
	const [property, setProperty] = useState("");
	const [offers, setOffers] = useState<AvailabilityOffer[] | null>(null);
	const [roomType, setRoomType] = useState("");
	const [guest, setGuest] = useState({ full_name: "", email: "", phone: "" });
	const [confirming, setConfirming] = useState(false);

	// Client-side date guard — prevents the 400 from invalid ranges.
	const datesValid = Boolean(arrival && departure && departure > arrival);

	async function doSearch() {
		if (!datesValid) {
			toast.error("Pick an arrival and a later departure date");
			return;
		}
		setSearching(true);
		setOffers(null);
		setRoomType("");
		try {
			const result = await searchAvailability(arrival, departure, parseInt(adults, 10) || 2);
			setProperty(result.property);
			setOffers(result.offers);
			if (result.offers.length === 0) toast.info("No availability for those dates");
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Availability search failed", { description: detail });
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
			toast.success("Booking confirmed", { description: result.reservation });
			go(`#/reservations/${encodeURIComponent(result.reservation)}`);
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Could not confirm booking", { description: detail });
		} finally {
			setConfirming(false);
		}
	}

	return (
		<WorkspacePage badge="Reservations" title="New booking" onBack={() => go("#/reservations")}>
			{/* 1 — Stay */}
			<Card>
				<CardContent className="flex flex-col gap-4 p-6">
					<h3 className="text-sm font-semibold">1 · Stay dates</h3>
					<div className="grid gap-4 sm:grid-cols-4">
						<Field label="Arrival"><Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} data-testid="b-arrival" /></Field>
						<Field label="Departure"><Input type="date" value={departure} min={arrival} onChange={(e) => setDeparture(e.target.value)} data-testid="b-departure" /></Field>
						<Field label="Adults"><Input type="number" min="1" value={adults} onChange={(e) => setAdults(e.target.value)} /></Field>
						<div className="flex items-end">
							<Button onClick={doSearch} disabled={searching || !datesValid} data-testid="b-search" className="w-full">
								{searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Check availability
							</Button>
						</div>
					</div>
					{!datesValid ? <p className="text-xs text-destructive">Departure must be after arrival.</p> : null}
				</CardContent>
			</Card>

			{/* 2 — Offers */}
			{offers ? (
				<Card>
					<CardContent className="flex flex-col gap-3 p-6">
						<h3 className="text-sm font-semibold">2 · Available room types</h3>
						{offers.length === 0 ? (
							<p className="text-sm text-muted-foreground">No availability — try other dates.</p>
						) : (
							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="offers">
								{offers.map((o) => (
									<button
										key={o.room_type}
										type="button"
										onClick={() => setRoomType(o.room_type)}
										data-testid={`offer-${o.room_type}`}
										className={[
											"flex flex-col gap-1 rounded-lg border p-4 text-left",
											roomType === o.room_type ? "border-foreground bg-muted" : "border-border hover:bg-muted/50",
										].join(" ")}
									>
										<div className="flex items-center justify-between">
											<span className="flex items-center gap-2 font-medium"><BedDouble className="size-4" />{o.room_type}</span>
											{roomType === o.room_type ? <Check className="size-4" /> : null}
										</div>
										<div className="flex items-center justify-between text-sm text-muted-foreground">
											<span>{o.available_count} available</span>
											{typeof o.estimated_amount === "number" ? <span>{formatCurrency(o.estimated_amount, "INR")}</span> : null}
										</div>
									</button>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			) : null}

			{/* 3 — Guest + confirm */}
			{roomType ? (
				<Card>
					<CardContent className="flex flex-col gap-4 p-6">
						<h3 className="text-sm font-semibold">3 · Guest details</h3>
						<div className="grid gap-4 sm:grid-cols-3">
							<Field label="Full name"><Input value={guest.full_name} onChange={(e) => setGuest({ ...guest, full_name: e.target.value })} data-testid="b-guest-name" /></Field>
							<Field label="Email"><Input value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /></Field>
							<Field label="Phone"><Input value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} /></Field>
						</div>
						<div className="flex items-center gap-3">
							<Button onClick={confirm} disabled={confirming || !guest.full_name} data-testid="b-confirm">
								{confirming ? <Loader2 className="size-4 animate-spin" /> : null} Confirm booking
							</Button>
							<Badge variant="secondary">{roomType}</Badge>
						</div>
					</CardContent>
				</Card>
			) : null}
		</WorkspacePage>
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
