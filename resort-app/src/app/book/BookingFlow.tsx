/**
 * Public guest booking — a premium marketing landing page (spec 002 direct
 * channel). Reachable at #/book with no login. Full-bleed hero + floating
 * search → room showcase → details → confirmation. Deliberately styled with an
 * explicit warm luxe palette (ivory / ink / gold) so it reads premium for any
 * visitor regardless of the app theme, and never confirms or charges — a
 * request lands as a Hold that staff confirm and take the deposit for.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BedDouble, Check, Loader2, Search, Users } from "lucide-react";

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

const GOLD = "#b08d57";

function inr(n: number) {
	return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function today(offset = 0) {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	return d.toISOString().slice(0, 10);
}
function prettyDate(iso: string) {
	try {
		return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
	} catch {
		return iso;
	}
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

	const [heroImage, setHeroImage] = useState<string | null>(null);
	const [fromRate, setFromRate] = useState<number | null>(null);
	const [result, setResult] = useState<SearchResult | null>(null);
	const [offer, setOffer] = useState<BookingOffer | null>(null);
	const [booker, setBooker] = useState({ full_name: "", email: "", phone: "" });
	const [confirmation, setConfirmation] = useState<BookingRequestResult | null>(null);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Fetch a hero image + "from" rate for the landing without disturbing the form.
	useEffect(() => {
		guestSearch({ arrival_date: today(7), departure_date: today(9), adults: 2, children: 0 })
			.then((res) => {
				const withImg = res.offers.find((o) => o.image);
				setHeroImage(withImg?.image ?? null);
				const nights = res.nights || 1;
				const cheapest = res.offers.reduce<number | null>(
					(min, o) => (min === null ? o.total_amount : Math.min(min, o.total_amount)),
					null,
				);
				if (cheapest !== null) setFromRate(Math.round(cheapest / nights));
			})
			.catch(() => {});
	}, []);

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
			window.scrollTo({ top: 0 });
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
			window.scrollTo({ top: 0 });
		} catch (e) {
			setError(errMessage(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="min-h-svh bg-[#faf7f2] text-[#1c1917]">
			{mode === "lookup" ? (
				<LookupPage onBack={() => setMode("book")} />
			) : step === "search" ? (
				<Hero
					heroImage={heroImage}
					fromRate={fromRate}
					arrival={arrival}
					departure={departure}
					adults={adults}
					children={children}
					busy={busy}
					error={error}
					setArrival={setArrival}
					setDeparture={setDeparture}
					setAdults={setAdults}
					setChildren={setChildren}
					onSearch={search}
					onLookup={() => setMode("lookup")}
				/>
			) : (
				<div className="mx-auto max-w-5xl px-6 py-10">
					<TopBar onLookup={() => setMode("lookup")} />
					{error ? <Notice text={error} /> : null}
					{step === "rooms" && result ? (
						<Rooms
							result={result}
							busy={busy}
							onBack={() => setStep("search")}
							onSelect={(o) => {
								setOffer(o);
								setStep("details");
								window.scrollTo({ top: 0 });
							}}
						/>
					) : step === "details" && result && offer ? (
						<Details
							result={result}
							offer={offer}
							booker={booker}
							busy={busy}
							setBooker={setBooker}
							onBack={() => setStep("rooms")}
							onConfirm={requestBooking}
						/>
					) : step === "done" && confirmation ? (
						<Done confirmation={confirmation} />
					) : null}
				</div>
			)}
		</div>
	);
}

/* ---------- shared ---------- */

function Wordmark({ light }: { light?: boolean }) {
	return (
		<div className={`flex items-center gap-2 ${light ? "text-white" : "text-[#1c1917]"}`}>
			<BedDouble className="size-5" style={{ color: light ? "#fff" : GOLD }} />
			<span className="font-display text-lg font-semibold tracking-[0.02em]">THE REEZORT</span>
		</div>
	);
}

function TopBar({ onLookup }: { onLookup: () => void }) {
	return (
		<div className="mb-8 flex items-center justify-between">
			<a href="/resort-app#/book" className="contents">
				<Wordmark />
			</a>
			<button className="text-sm text-[#78716c] underline-offset-4 hover:text-[#1c1917] hover:underline" onClick={onLookup}>
				Look up a booking
			</button>
		</div>
	);
}

function Notice({ text }: { text: string }) {
	return (
		<div className="mb-6 rounded-lg border border-[#c0392b]/30 bg-[#c0392b]/5 px-4 py-3 text-sm text-[#a5382a]">
			{text}
		</div>
	);
}

const goldBtn =
	"inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-white transition-colors disabled:opacity-60";

/* ---------- hero + search ---------- */

function Hero(props: {
	heroImage: string | null;
	fromRate: number | null;
	arrival: string;
	departure: string;
	adults: number;
	children: number;
	busy: boolean;
	error: string | null;
	setArrival: (v: string) => void;
	setDeparture: (v: string) => void;
	setAdults: (v: number) => void;
	setChildren: (v: number) => void;
	onSearch: () => void;
	onLookup: () => void;
}) {
	return (
		<section className="relative isolate flex min-h-svh flex-col">
			<div className="absolute inset-0 -z-10">
				{props.heroImage ? (
					<img src={props.heroImage} alt="" className="h-full w-full object-cover" />
				) : (
					<div className="h-full w-full bg-gradient-to-br from-[#2b2822] to-[#0e0d0b]" />
				)}
				<div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/25 to-black/80" />
			</div>

			<nav className="flex items-center justify-between px-6 py-6 sm:px-10">
				<Wordmark light />
				<button className="text-sm text-white/80 underline-offset-4 hover:text-white hover:underline" onClick={props.onLookup}>
					Look up a booking
				</button>
			</nav>

			<div className="flex flex-1 flex-col items-center justify-center px-6 pb-40 pt-10 text-center text-white">
				<p className="mb-4 text-[0.7rem] uppercase tracking-[0.35em] text-white/70">A private coastal retreat</p>
				<h1 className="font-display max-w-3xl text-4xl font-light leading-[1.05] sm:text-6xl">
					Where the arch meets the sea
				</h1>
				<p className="mt-5 max-w-xl text-base text-white/80">
					Signature villas, unhurried mornings, and the quiet luxury of space. Reserve your stay at THE REEZORT.
				</p>
				{props.fromRate ? (
					<p className="mt-6 text-sm text-white/70">
						From <span className="font-medium text-white">{inr(props.fromRate)}</span> / night
					</p>
				) : null}
			</div>

			{/* Floating search card */}
			<div className="relative z-10 mx-auto -mb-24 w-full max-w-4xl px-6">
				<div className="rounded-2xl border border-white/60 bg-white/95 p-5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)] backdrop-blur sm:p-6">
					{props.error ? <Notice text={props.error} /> : null}
					<div className="grid gap-4 sm:grid-cols-4">
						<Field label="Arrival">
							<input type="date" value={props.arrival} min={today()} onChange={(e) => props.setArrival(e.target.value)}
								className={inputCls} data-testid="book-arrival" />
						</Field>
						<Field label="Departure">
							<input type="date" value={props.departure} min={props.arrival} onChange={(e) => props.setDeparture(e.target.value)}
								className={inputCls} data-testid="book-departure" />
						</Field>
						<Field label="Adults">
							<input type="number" min={1} value={props.adults} onChange={(e) => props.setAdults(Number(e.target.value) || 1)} className={inputCls} />
						</Field>
						<Field label="Children">
							<input type="number" min={0} value={props.children} onChange={(e) => props.setChildren(Number(e.target.value) || 0)} className={inputCls} />
						</Field>
					</div>
					<button className={`${goldBtn} mt-5 w-full`} style={{ backgroundColor: GOLD }} onClick={props.onSearch} disabled={props.busy} data-testid="book-search">
						{props.busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Check availability
					</button>
				</div>
			</div>
			<div className="h-28" />
		</section>
	);
}

const inputCls =
	"w-full rounded-lg border border-[#e2ddd3] bg-white px-3 py-2.5 text-sm text-[#1c1917] outline-none focus:border-[#b08d57] focus:ring-2 focus:ring-[#b08d57]/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-[0.7rem] font-medium uppercase tracking-wider text-[#8a8378]">{label}</span>
			{children}
		</label>
	);
}

/* ---------- rooms ---------- */

function Rooms(props: { result: SearchResult; busy: boolean; onBack: () => void; onSelect: (o: BookingOffer) => void }) {
	const { result } = props;
	return (
		<div>
			<button className="mb-4 inline-flex items-center gap-1 text-sm text-[#78716c] hover:text-[#1c1917]" onClick={props.onBack}>
				<ArrowLeft className="size-4" /> Change dates
			</button>
			<div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-[#e7e2d9] pb-4">
				<h2 className="font-display text-3xl font-light">Choose your villa</h2>
				<span className="text-sm text-[#78716c]">
					{prettyDate(result.arrival_date)} – {prettyDate(result.departure_date)} · {result.nights} night{result.nights === 1 ? "" : "s"}
				</span>
			</div>
			{result.offers.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-[#d8d2c6] py-20 text-center text-sm text-[#78716c]">
					No villas available for those dates. Try different dates.
				</div>
			) : (
				<div className="grid gap-6 sm:grid-cols-2">
					{result.offers.map((o) => (
						<article key={o.room_type} className="group overflow-hidden rounded-2xl border border-[#e7e2d9] bg-white shadow-sm transition-shadow hover:shadow-lg">
							<div className="aspect-[4/3] overflow-hidden bg-[#efeae1]">
								{o.image ? (
									<img src={o.image} alt={o.room_type_name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
								) : (
									<div className="flex h-full items-center justify-center text-[#c2b8a5]"><BedDouble className="size-8" /></div>
								)}
							</div>
							<div className="flex flex-col gap-3 p-5">
								<div className="flex items-start justify-between gap-3">
									<div>
										<h3 className="font-display text-xl">{o.room_type_name}</h3>
										<p className="mt-1 flex items-center gap-1 text-xs text-[#8a8378]">
											<Users className="size-3" /> Sleeps {o.max_occupancy || "—"} · {o.available_count} left
										</p>
									</div>
									<div className="text-right">
										<div className="font-display text-xl">{inr(o.total_amount)}</div>
										<div className="text-[0.7rem] text-[#8a8378]">total · {result.nights}n</div>
									</div>
								</div>
								<button
									className={`${goldBtn} w-full`}
									style={{ backgroundColor: o.fits_party && o.available_count > 0 ? GOLD : "#c9c1b2" }}
									disabled={props.busy || !o.fits_party || o.available_count < 1}
									onClick={() => props.onSelect(o)}
									data-testid={`book-select-${o.room_type}`}
								>
									{o.fits_party ? "Reserve" : "Over capacity"} {o.fits_party ? <ArrowRight className="size-4" /> : null}
								</button>
							</div>
						</article>
					))}
				</div>
			)}
		</div>
	);
}

/* ---------- details ---------- */

function Details(props: {
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
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div>
				<button className="mb-4 inline-flex items-center gap-1 text-sm text-[#78716c] hover:text-[#1c1917]" onClick={props.onBack}>
					<ArrowLeft className="size-4" /> Change villa
				</button>
				<h2 className="font-display mb-6 text-3xl font-light">Your details</h2>
				<div className="grid gap-5 sm:grid-cols-2">
					<div className="sm:col-span-2">
						<Field label="Full name">
							<input value={booker.full_name} onChange={(e) => props.setBooker({ ...booker, full_name: e.target.value })} className={inputCls} data-testid="book-name" />
						</Field>
					</div>
					<Field label="Email">
						<input type="email" value={booker.email} onChange={(e) => props.setBooker({ ...booker, email: e.target.value })} className={inputCls} data-testid="book-email" />
					</Field>
					<Field label="Phone">
						<input value={booker.phone} onChange={(e) => props.setBooker({ ...booker, phone: e.target.value })} className={inputCls} data-testid="book-phone" />
					</Field>
				</div>
				<button className={`${goldBtn} mt-7`} style={{ backgroundColor: GOLD }} onClick={props.onConfirm} disabled={props.busy} data-testid="book-confirm">
					{props.busy ? <Loader2 className="size-4 animate-spin" /> : null} Request booking
				</button>
				<p className="mt-3 text-xs text-[#8a8378]">
					We'll hold your villa and email a confirmation with a secure deposit link. No charge is made now.
				</p>
			</div>

			{/* Summary */}
			<aside className="h-fit overflow-hidden rounded-2xl border border-[#e7e2d9] bg-white shadow-sm">
				<div className="aspect-[4/3] bg-[#efeae1]">
					{offer.image ? <img src={offer.image} alt={offer.room_type_name} className="h-full w-full object-cover" /> : null}
				</div>
				<div className="flex flex-col gap-2 p-5 text-sm">
					<h3 className="font-display text-lg">{offer.room_type_name}</h3>
					<div className="flex justify-between text-[#78716c]">
						<span>Dates</span>
						<span className="text-[#1c1917]">{prettyDate(result.arrival_date)} – {prettyDate(result.departure_date)}</span>
					</div>
					<div className="flex justify-between text-[#78716c]">
						<span>Nights</span>
						<span className="text-[#1c1917]">{result.nights}</span>
					</div>
					<div className="mt-2 flex justify-between border-t border-[#e7e2d9] pt-3">
						<span className="font-medium">Estimated total</span>
						<span className="font-display text-lg">{inr(offer.total_amount)}</span>
					</div>
				</div>
			</aside>
		</div>
	);
}

/* ---------- done ---------- */

function Done({ confirmation }: { confirmation: BookingRequestResult }) {
	return (
		<div className="mx-auto max-w-xl py-10 text-center">
			<div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: `${GOLD}1a`, color: GOLD }}>
				<Check className="size-8" />
			</div>
			<h2 className="font-display text-3xl font-light">Your villa is held</h2>
			<p className="mx-auto mt-3 max-w-md text-sm text-[#78716c]">
				Thank you, {confirmation.guest_name}. We've reserved the <strong>{confirmation.room_type_name}</strong> for{" "}
				{prettyDate(confirmation.arrival_date)} – {prettyDate(confirmation.departure_date)}. A confirmation and secure
				deposit link are on their way to your inbox.
			</p>
			<div className="mx-auto mt-8 w-fit rounded-2xl border border-[#e7e2d9] bg-white px-10 py-6 shadow-sm">
				<p className="text-[0.7rem] uppercase tracking-widest text-[#8a8378]">Booking reference</p>
				<p className="font-display mt-1 text-2xl">{confirmation.reference}</p>
				<p className="mt-3 text-sm text-[#78716c]">
					Estimated total <span className="font-medium text-[#1c1917]">{inr(confirmation.estimated_total)}</span>
				</p>
			</div>
			<button className="mt-8 text-sm text-[#78716c] underline underline-offset-4 hover:text-[#1c1917]" onClick={() => window.location.reload()}>
				Book another stay
			</button>
		</div>
	);
}

/* ---------- lookup ---------- */

function LookupPage({ onBack }: { onBack: () => void }) {
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
		<div className="mx-auto max-w-2xl px-6 py-10">
			<div className="mb-8 flex items-center justify-between">
				<Wordmark />
				<button className="text-sm text-[#78716c] underline-offset-4 hover:text-[#1c1917] hover:underline" onClick={onBack}>
					Book a stay
				</button>
			</div>
			<h1 className="font-display text-3xl font-light">Look up your booking</h1>
			{error ? <div className="mt-4"><Notice text={error} /></div> : null}
			<div className="mt-6 grid gap-4 rounded-2xl border border-[#e7e2d9] bg-white p-6 shadow-sm sm:grid-cols-2">
				<Field label="Booking reference">
					<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="RZ-…" className={inputCls} data-testid="lookup-ref" />
				</Field>
				<Field label="Email">
					<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} data-testid="lookup-email" />
				</Field>
			</div>
			<button className={`${goldBtn} mt-5`} style={{ backgroundColor: GOLD }} onClick={lookup} disabled={busy} data-testid="lookup-submit">
				{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Find booking
			</button>

			{found ? (
				<div className="mt-6 rounded-2xl border border-[#e7e2d9] bg-white p-6 shadow-sm">
					<div className="flex items-center justify-between border-b border-[#e7e2d9] pb-3">
						<span className="font-display text-lg">{found.reference}</span>
						<span className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: `${GOLD}1a`, color: GOLD }}>{found.status}</span>
					</div>
					<dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
						<dt className="text-[#78716c]">Guest</dt><dd className="text-right">{found.guest_name ?? "—"}</dd>
						<dt className="text-[#78716c]">Villa</dt><dd className="text-right">{found.room_type_name ?? "—"}</dd>
						<dt className="text-[#78716c]">Dates</dt>
						<dd className="text-right">{found.arrival_date ? `${prettyDate(found.arrival_date)} – ${prettyDate(found.departure_date ?? found.arrival_date)}` : "—"}</dd>
						<dt className="text-[#78716c]">Deposit</dt><dd className="text-right">{found.deposit_status ?? "—"}</dd>
						<dt className="text-[#78716c]">Estimated total</dt><dd className="text-right">{inr(found.total_estimated_amount)}</dd>
					</dl>
				</div>
			) : null}
		</div>
	);
}
