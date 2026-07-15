/**
 * Public guest booking flow (spec 002 direct-booking channel). Reachable at
 * #/book without a login. Search → choose room → your details → request →
 * confirmation. A booking request lands as a Hold that staff confirm and take
 * the deposit for; this flow never charges the guest directly.
 */

import { useState } from "react";
import { BedDouble, CalendarCheck, Loader2, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/components/folio/folio-format";
import {
	GuestBookingError,
	guestLookupBooking,
	guestRequestBooking,
	guestSearch,
	type BookingLookup,
	type BookingOffer,
	type BookingRequestResult,
	type SearchResult,
} from "@/lib/guest-booking-api";

function today(offset = 0) {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	return d.toISOString().slice(0, 10);
}

function errMessage(e: unknown) {
	return e instanceof GuestBookingError ? e.message : "Something went wrong. Please try again.";
}

type Step = "search" | "rooms" | "details" | "done";

export default function BookingFlow() {
	const [mode, setMode] = useState<"book" | "lookup">("book");
	const [step, setStep] = useState<Step>("search");

	const [arrival, setArrival] = useState(today(7));
	const [departure, setDeparture] = useState(today(9));
	const [adults, setAdults] = useState(2);
	const [children, setChildren] = useState(0);

	const [result, setResult] = useState<SearchResult | null>(null);
	const [offer, setOffer] = useState<BookingOffer | null>(null);
	const [booker, setBooker] = useState({ full_name: "", email: "", phone: "" });
	const [confirmation, setConfirmation] = useState<BookingRequestResult | null>(null);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function search() {
		setError(null);
		if (departure <= arrival) {
			setError("Departure must be after arrival.");
			return;
		}
		setBusy(true);
		try {
			const res = await guestSearch({ arrival_date: arrival, departure_date: departure, adults, children });
			setResult(res);
			setStep("rooms");
		} catch (e) {
			setError(errMessage(e));
		} finally {
			setBusy(false);
		}
	}

	async function requestBooking() {
		if (!result || !offer) return;
		setError(null);
		if (!booker.full_name.trim() || !booker.email.trim() || !booker.phone.trim()) {
			setError("Please fill in your name, email, and phone.");
			return;
		}
		setBusy(true);
		try {
			const res = await guestRequestBooking({
				property: result.property,
				arrival_date: arrival,
				departure_date: departure,
				room_type: offer.room_type,
				quantity: 1,
				adults,
				children,
				booker,
			});
			setConfirmation(res);
			setStep("done");
		} catch (e) {
			setError(errMessage(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="min-h-svh bg-background">
			<header className="border-b">
				<div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
					<div className="flex items-center gap-2">
						<BedDouble className="size-5" />
						<span className="text-lg font-semibold tracking-tight">THE REEZORT</span>
					</div>
					<button
						className="text-sm text-muted-foreground hover:text-foreground"
						onClick={() => {
							setMode(mode === "book" ? "lookup" : "book");
							setError(null);
						}}
					>
						{mode === "book" ? "Look up a booking" : "Book a stay"}
					</button>
				</div>
			</header>

			<main className="mx-auto max-w-3xl px-4 py-8">
				{error ? (
					<div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
						{error}
					</div>
				) : null}

				{mode === "lookup" ? (
					<LookupPanel />
				) : step === "search" ? (
					<SearchPanel
						arrival={arrival}
						departure={departure}
						adults={adults}
						children={children}
						busy={busy}
						setArrival={setArrival}
						setDeparture={setDeparture}
						setAdults={setAdults}
						setChildren={setChildren}
						onSearch={search}
					/>
				) : step === "rooms" && result ? (
					<RoomsPanel
						result={result}
						busy={busy}
						onBack={() => setStep("search")}
						onSelect={(o) => {
							setOffer(o);
							setStep("details");
						}}
					/>
				) : step === "details" && result && offer ? (
					<DetailsPanel
						result={result}
						offer={offer}
						booker={booker}
						busy={busy}
						setBooker={setBooker}
						onBack={() => setStep("rooms")}
						onConfirm={requestBooking}
					/>
				) : step === "done" && confirmation ? (
					<DonePanel confirmation={confirmation} />
				) : null}
			</main>
		</div>
	);
}

function SearchPanel(props: {
	arrival: string;
	departure: string;
	adults: number;
	children: number;
	busy: boolean;
	setArrival: (v: string) => void;
	setDeparture: (v: string) => void;
	setAdults: (v: number) => void;
	setChildren: (v: number) => void;
	onSearch: () => void;
}) {
	return (
		<section className="flex flex-col gap-5">
			<div>
				<h1 className="text-3xl font-light tracking-tight">Book your stay</h1>
				<p className="mt-1 text-sm text-muted-foreground">Check availability and request your room.</p>
			</div>
			<div className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label>Arrival</Label>
					<Input type="date" value={props.arrival} min={today()} onChange={(e) => props.setArrival(e.target.value)} data-testid="book-arrival" />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Departure</Label>
					<Input type="date" value={props.departure} min={props.arrival} onChange={(e) => props.setDeparture(e.target.value)} data-testid="book-departure" />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Adults</Label>
					<Input type="number" min={1} value={props.adults} onChange={(e) => props.setAdults(Number(e.target.value) || 1)} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Children</Label>
					<Input type="number" min={0} value={props.children} onChange={(e) => props.setChildren(Number(e.target.value) || 0)} />
				</div>
			</div>
			<Button size="lg" onClick={props.onSearch} disabled={props.busy} data-testid="book-search">
				{props.busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search availability
			</Button>
		</section>
	);
}

function RoomsPanel(props: {
	result: SearchResult;
	busy: boolean;
	onBack: () => void;
	onSelect: (offer: BookingOffer) => void;
}) {
	const { result } = props;
	return (
		<section className="flex flex-col gap-4">
			<button className="text-sm text-muted-foreground hover:text-foreground" onClick={props.onBack}>
				← Change dates
			</button>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-2xl font-light">Available rooms</h2>
				<span className="text-sm text-muted-foreground">
					{result.arrival_date} → {result.departure_date} · {result.nights} night{result.nights === 1 ? "" : "s"}
				</span>
			</div>
			{result.offers.length === 0 ? (
				<div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
					No rooms available for those dates. Try different dates.
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{result.offers.map((o) => (
						<div key={o.room_type} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
							<div className="h-24 w-full overflow-hidden rounded-lg bg-muted sm:w-36">
								{o.image ? (
									<img src={o.image} alt={o.room_type_name} className="h-full w-full object-cover" />
								) : (
									<div className="flex h-full items-center justify-center text-muted-foreground">
										<BedDouble className="size-6" />
									</div>
								)}
							</div>
							<div className="flex flex-1 flex-col gap-1">
								<div className="flex items-center gap-2">
									<h3 className="font-medium">{o.room_type_name}</h3>
									{!o.fits_party ? <Badge variant="outline">Over capacity</Badge> : null}
								</div>
								<p className="flex items-center gap-1 text-xs text-muted-foreground">
									<Users className="size-3" /> Sleeps {o.max_occupancy || "—"} · {o.available_count} left
								</p>
							</div>
							<div className="flex flex-col items-end gap-2">
								<span className="text-lg font-semibold">{formatCurrency(o.total_amount, o.currency ?? "INR")}</span>
								<Button
									size="sm"
									disabled={props.busy || !o.fits_party || o.available_count < 1}
									onClick={() => props.onSelect(o)}
									data-testid={`book-select-${o.room_type}`}
								>
									Select
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

function DetailsPanel(props: {
	result: SearchResult;
	offer: BookingOffer;
	booker: { full_name: string; email: string; phone: string };
	busy: boolean;
	setBooker: (b: { full_name: string; email: string; phone: string }) => void;
	onBack: () => void;
	onConfirm: () => void;
}) {
	const { result, offer, booker } = props;
	return (
		<section className="flex flex-col gap-4">
			<button className="text-sm text-muted-foreground hover:text-foreground" onClick={props.onBack}>
				← Change room
			</button>
			<h2 className="text-2xl font-light">Your details</h2>

			<div className="rounded-xl border p-4 text-sm">
				<div className="flex items-center justify-between">
					<span className="font-medium">{offer.room_type_name}</span>
					<span className="font-semibold">{formatCurrency(offer.total_amount, offer.currency ?? "INR")}</span>
				</div>
				<p className="mt-1 text-muted-foreground">
					{result.arrival_date} → {result.departure_date} · {result.nights} night{result.nights === 1 ? "" : "s"}
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5 sm:col-span-2">
					<Label>Full name</Label>
					<Input value={booker.full_name} onChange={(e) => props.setBooker({ ...booker, full_name: e.target.value })} data-testid="book-name" />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Email</Label>
					<Input type="email" value={booker.email} onChange={(e) => props.setBooker({ ...booker, email: e.target.value })} data-testid="book-email" />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Phone</Label>
					<Input value={booker.phone} onChange={(e) => props.setBooker({ ...booker, phone: e.target.value })} data-testid="book-phone" />
				</div>
			</div>

			<Button size="lg" onClick={props.onConfirm} disabled={props.busy} data-testid="book-confirm">
				{props.busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />} Request booking
			</Button>
			<p className="text-center text-xs text-muted-foreground">
				We'll hold your room and email you a confirmation with a secure deposit link.
			</p>
		</section>
	);
}

function DonePanel({ confirmation }: { confirmation: BookingRequestResult }) {
	return (
		<section className="flex flex-col items-center gap-4 py-8 text-center">
			<div className="flex size-14 items-center justify-center rounded-full bg-[#198038]/10 text-[#198038] dark:text-[#42be65]">
				<CalendarCheck className="size-7" />
			</div>
			<h2 className="text-2xl font-light">Booking requested</h2>
			<p className="max-w-md text-sm text-muted-foreground">
				Thanks, {confirmation.guest_name}. We've held a <strong>{confirmation.room_type_name}</strong> for{" "}
				{confirmation.arrival_date} → {confirmation.departure_date}. We'll email you a confirmation and a deposit link
				to secure it.
			</p>
			<div className="rounded-xl border px-6 py-4">
				<p className="text-xs text-muted-foreground">Your reference</p>
				<p className="font-mono text-lg font-semibold">{confirmation.reference}</p>
				<p className="mt-2 text-sm">
					Estimated total{" "}
					<span className="font-semibold">
						{formatCurrency(confirmation.estimated_total, confirmation.currency ?? "INR")}
					</span>
				</p>
			</div>
			<button className="text-sm text-muted-foreground underline" onClick={() => window.location.reload()}>
				Book another stay
			</button>
		</section>
	);
}

function LookupPanel() {
	const [reference, setReference] = useState("");
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [found, setFound] = useState<BookingLookup | null>(null);

	async function lookup() {
		setError(null);
		setFound(null);
		if (!reference.trim() || !email.trim()) {
			setError("Enter your reference and email.");
			return;
		}
		setBusy(true);
		try {
			setFound(await guestLookupBooking(reference.trim(), email.trim()));
		} catch (e) {
			setError(errMessage(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="flex flex-col gap-4">
			<h1 className="text-3xl font-light tracking-tight">Look up your booking</h1>
			{error ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{error}
				</div>
			) : null}
			<div className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label>Booking reference</Label>
					<Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="RZ-…" data-testid="lookup-ref" />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Email</Label>
					<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="lookup-email" />
				</div>
			</div>
			<Button onClick={lookup} disabled={busy} data-testid="lookup-submit">
				{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Find booking
			</Button>

			{found ? (
				<div className="rounded-xl border p-5">
					<div className="flex items-center justify-between">
						<span className="font-mono font-semibold">{found.reference}</span>
						<Badge variant="secondary">{found.status}</Badge>
					</div>
					<dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
						<dt className="text-muted-foreground">Guest</dt>
						<dd className="text-right">{found.guest_name ?? "—"}</dd>
						<dt className="text-muted-foreground">Room</dt>
						<dd className="text-right">{found.room_type_name ?? "—"}</dd>
						<dt className="text-muted-foreground">Dates</dt>
						<dd className="text-right">{found.arrival_date} → {found.departure_date}</dd>
						<dt className="text-muted-foreground">Deposit</dt>
						<dd className="text-right">{found.deposit_status ?? "—"}</dd>
						<dt className="text-muted-foreground">Estimated total</dt>
						<dd className="text-right">{formatCurrency(found.total_estimated_amount, found.currency ?? "INR")}</dd>
					</dl>
				</div>
			) : null}
		</section>
	);
}
