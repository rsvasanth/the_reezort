/**
 * THE REEZORT — public marketing website + online reservation (spec 002).
 * Reachable at #/book with no login. A complete 5-star site: hero, story,
 * villas, experiences, dining, gallery, contact — all data-driven from the
 * live property via guest_site_content — with the reservation journey
 * (search → villa → details → confirmation) woven in. Warm luxe palette
 * (ivory / ink / gold) rendered explicitly so it reads premium regardless of
 * the app theme. Requests land as 48h Holds; no charge is taken online.
 */

import { useEffect, useState } from "react";
import {
	ArrowLeft,
	ArrowRight,
	BedDouble,
	Check,
	Clock,
	Loader2,
	Mail,
	MapPin,
	Phone,
	Search,
	Sparkles,
	Users,
	UtensilsCrossed,
	Waves,
	Wine,
} from "lucide-react";

import {
	GuestBookingError,
	guestCaptureDeposit,
	guestDepositOrder,
	guestLookupBooking,
	guestRequestBooking,
	guestSearch,
	guestSiteContent,
	type BookingLookup,
	type BookingOffer,
	type BookingRequestResult,
	type GuestDepositResult,
	type SearchResult,
	type SiteContent,
} from "@/lib/guest-booking-api";
import { openRazorpayCheckout } from "@/lib/razorpay";

const GOLD = "#b08d57";
const INK = "#1c1917";
const MUTED = "#78716c";

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

type View = "site" | "rooms" | "details" | "done" | "lookup";

export default function BookingFlow() {
	const [view, setView] = useState<View>("site");
	const [site, setSite] = useState<SiteContent | null>(null);

	const [arrival, setArrival] = useState(today(7));
	const [departure, setDeparture] = useState(today(9));
	const [adults, setAdults] = useState(2);
	const [childCount, setChildCount] = useState(0);

	const [result, setResult] = useState<SearchResult | null>(null);
	const [offer, setOffer] = useState<BookingOffer | null>(null);
	const [booker, setBooker] = useState({ full_name: "", email: "", phone: "" });
	const [confirmation, setConfirmation] = useState<BookingRequestResult | null>(null);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		guestSiteContent().then(setSite).catch(() => {});
	}, []);

	async function search() {
		setError(null);
		if (departure <= arrival) {
			setError("Departure must be after arrival.");
			return;
		}
		setBusy(true);
		try {
			const res = await guestSearch({ arrival_date: arrival, departure_date: departure, adults, children: childCount });
			setResult(res);
			setView("rooms");
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
				children: childCount,
				booker,
			});
			setConfirmation(res);
			setView("done");
			window.scrollTo({ top: 0 });
		} catch (e) {
			setError(errMessage(e));
		} finally {
			setBusy(false);
		}
	}

	if (view === "site") {
		return (
			<SitePage
				site={site}
				arrival={arrival}
				departure={departure}
				adults={adults}
				childCount={childCount}
				busy={busy}
				error={error}
				setArrival={setArrival}
				setDeparture={setDeparture}
				setAdults={setAdults}
				setChildCount={setChildCount}
				onSearch={search}
				onLookup={() => setView("lookup")}
			/>
		);
	}

	return (
		<div className="min-h-svh bg-[#faf7f2] text-[#1c1917]">
			<div className="mx-auto max-w-5xl px-6 py-10">
				<div className="mb-8 flex items-center justify-between">
					<button className="contents" onClick={() => setView("site")}>
						<Wordmark />
					</button>
					<button className="text-sm underline-offset-4 hover:underline" style={{ color: MUTED }} onClick={() => setView(view === "lookup" ? "site" : "lookup")}>
						{view === "lookup" ? "Back to the resort" : "Look up a booking"}
					</button>
				</div>
				{error ? <Notice text={error} /> : null}
				{view === "rooms" && result ? (
					<Rooms
						result={result}
						busy={busy}
						onBack={() => setView("site")}
						onSelect={(o) => {
							setOffer(o);
							setView("details");
							window.scrollTo({ top: 0 });
						}}
					/>
				) : view === "details" && result && offer ? (
					<Details
						result={result}
						offer={offer}
						booker={booker}
						busy={busy}
						setBooker={setBooker}
						onBack={() => setView("rooms")}
						onConfirm={requestBooking}
					/>
				) : view === "done" && confirmation ? (
					<Done confirmation={confirmation} booker={booker} onHome={() => setView("site")} />
				) : view === "lookup" ? (
					<Lookup />
				) : null}
			</div>
		</div>
	);
}

/* ================= shared ================= */

function Wordmark({ light }: { light?: boolean }) {
	return (
		<div className={`flex items-center gap-2 ${light ? "text-white" : "text-[#1c1917]"}`}>
			<BedDouble className="size-5" style={{ color: light ? "#fff" : GOLD }} />
			<span className="font-display text-lg font-semibold tracking-[0.02em]">THE REEZORT</span>
		</div>
	);
}

function Notice({ text }: { text: string }) {
	return (
		<div className="mb-6 rounded-lg border border-[#c0392b]/30 bg-[#c0392b]/5 px-4 py-3 text-sm text-[#a5382a]">{text}</div>
	);
}

const goldBtn =
	"inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60";
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

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
	return (
		<div className="mb-10 text-center">
			<p className="mb-3 text-[0.7rem] uppercase tracking-[0.35em]" style={{ color: GOLD }}>{eyebrow}</p>
			<h2 className="font-display text-3xl font-light sm:text-4xl" style={{ color: INK }}>{title}</h2>
		</div>
	);
}

/* ================= the site ================= */

function SitePage(props: {
	site: SiteContent | null;
	arrival: string;
	departure: string;
	adults: number;
	childCount: number;
	busy: boolean;
	error: string | null;
	setArrival: (v: string) => void;
	setDeparture: (v: string) => void;
	setAdults: (v: number) => void;
	setChildCount: (v: number) => void;
	onSearch: () => void;
	onLookup: () => void;
}) {
	const { site } = props;
	const fromRate = site?.villas.reduce<number | null>(
		(min, v) => (v.from_rate ? (min === null ? v.from_rate : Math.min(min, v.from_rate)) : min),
		null,
	);

	function scrollToId(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
	}

	return (
		<div className="min-h-svh bg-[#faf7f2] text-[#1c1917]">
			{/* Sticky nav */}
			<header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-black/30 backdrop-blur-md">
				<div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
					<Wordmark light />
					<nav className="hidden items-center gap-7 text-sm text-white/85 md:flex">
						<button className="hover:text-white" onClick={() => scrollToId("villas")}>Villas</button>
						<button className="hover:text-white" onClick={() => scrollToId("experiences")}>Experiences</button>
						<button className="hover:text-white" onClick={() => scrollToId("dining")}>Dining</button>
						<button className="hover:text-white" onClick={() => scrollToId("contact")}>Contact</button>
						<button className="hover:text-white" onClick={props.onLookup}>My booking</button>
					</nav>
					<button className={`${goldBtn} !px-5 !py-2`} style={{ backgroundColor: GOLD }} onClick={() => scrollToId("book")}>
						Book now
					</button>
				</div>
			</header>

			{/* Hero */}
			<section className="relative isolate flex min-h-svh flex-col justify-end">
				<div className="absolute inset-0 -z-10">
					{site?.hero_image ? (
						<img src={site.hero_image} alt="" className="h-full w-full object-cover" />
					) : (
						<div className="h-full w-full bg-gradient-to-br from-[#2b2822] to-[#0e0d0b]" />
					)}
					<div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/20 to-black/75" />
				</div>
				<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-6 pt-28 text-center text-white">
					<p className="mb-4 text-[0.7rem] uppercase tracking-[0.4em] text-white/70">A private coastal retreat</p>
					<h1 className="font-display max-w-3xl text-5xl font-light leading-[1.02] sm:text-7xl">
						Where the arch meets the sea
					</h1>
					<p className="mt-6 max-w-xl text-base text-white/85 sm:text-lg">
						Signature villas, unhurried mornings, and the quiet luxury of space.
					</p>
					{fromRate ? (
						<p className="mt-6 text-sm text-white/75">
							Villas from <span className="font-medium text-white">{inr(fromRate)}</span> / night
						</p>
					) : null}
				</div>

				{/* Availability bar */}
				<div id="book" className="mx-auto w-full max-w-5xl scroll-mt-24 px-6 pb-10">
					<div className="rounded-2xl border border-white/50 bg-white/95 p-5 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.5)] backdrop-blur sm:p-6">
						{props.error ? <Notice text={props.error} /> : null}
						<div className="grid gap-4 sm:grid-cols-5">
							<Field label="Arrival">
								<input type="date" value={props.arrival} min={today()} onChange={(e) => props.setArrival(e.target.value)} className={inputCls} data-testid="book-arrival" />
							</Field>
							<Field label="Departure">
								<input type="date" value={props.departure} min={props.arrival} onChange={(e) => props.setDeparture(e.target.value)} className={inputCls} data-testid="book-departure" />
							</Field>
							<Field label="Adults">
								<input type="number" min={1} value={props.adults} onChange={(e) => props.setAdults(Number(e.target.value) || 1)} className={inputCls} />
							</Field>
							<Field label="Children">
								<input type="number" min={0} value={props.childCount} onChange={(e) => props.setChildCount(Number(e.target.value) || 0)} className={inputCls} />
							</Field>
							<div className="flex items-end">
								<button className={`${goldBtn} w-full`} style={{ backgroundColor: GOLD }} onClick={props.onSearch} disabled={props.busy} data-testid="book-search">
									{props.busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
								</button>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Story */}
			<section className="mx-auto max-w-4xl px-6 py-24 text-center">
				<p className="mb-3 text-[0.7rem] uppercase tracking-[0.35em]" style={{ color: GOLD }}>The retreat</p>
				<h2 className="font-display text-3xl font-light leading-snug sm:text-4xl" style={{ color: INK }}>
					A handful of arched villas set between palms and the shore — built for
					slow days, golden evenings, and nothing on the calendar.
				</h2>
				<div className="mx-auto mt-8 h-px w-24" style={{ backgroundColor: GOLD }} />
				<p className="mx-auto mt-8 max-w-2xl text-base leading-7" style={{ color: MUTED }}>
					Every stay at {site?.property_name ?? "THE REEZORT"} is looked after end to end — from a private
					welcome at arrival to in-villa dining after dark. Few keys, full attention.
				</p>
			</section>

			{/* Villas */}
			<section id="villas" className="scroll-mt-24 bg-white py-24">
				<div className="mx-auto max-w-6xl px-6">
					<SectionTitle eyebrow="Stay" title="The villas" />
					<div className="grid gap-8 md:grid-cols-2">
						{(site?.villas ?? []).map((v) => (
							<article key={v.room_type} className="group overflow-hidden rounded-2xl border border-[#eee9df] bg-[#faf7f2] shadow-sm transition-shadow hover:shadow-xl">
								<div className="aspect-[16/10] overflow-hidden bg-[#efeae1]">
									{v.image ? (
										<img src={v.image} alt={v.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
									) : (
										<div className="flex h-full items-center justify-center text-[#c2b8a5]"><BedDouble className="size-8" /></div>
									)}
								</div>
								<div className="flex flex-col gap-3 p-6">
									<div className="flex items-start justify-between gap-4">
										<h3 className="font-display text-2xl font-light">{v.name}</h3>
										{v.from_rate ? (
											<div className="text-right">
												<div className="font-display text-lg">{inr(v.from_rate)}</div>
												<div className="text-[0.68rem] uppercase tracking-wider" style={{ color: MUTED }}>per night</div>
											</div>
										) : null}
									</div>
									{v.description ? (
										<p className="line-clamp-3 text-sm leading-6" style={{ color: MUTED }}>{v.description}</p>
									) : null}
									<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: MUTED }}>
										{v.max_occupancy ? <span className="inline-flex items-center gap-1"><Users className="size-3" /> Sleeps {v.max_occupancy}</span> : null}
										{v.bed_configuration ? <span className="inline-flex items-center gap-1"><BedDouble className="size-3" /> {v.bed_configuration}</span> : null}
										{v.view_tags.slice(0, 2).map((t) => (
											<span key={t} className="inline-flex items-center gap-1"><Waves className="size-3" /> {t}</span>
										))}
									</div>
									{v.amenities.length ? (
										<div className="flex flex-wrap gap-1.5 pt-1">
											{v.amenities.slice(0, 5).map((a) => (
												<span key={a} className="rounded-full border border-[#e5dfd2] px-2.5 py-0.5 text-[0.68rem]" style={{ color: MUTED }}>{a}</span>
											))}
										</div>
									) : null}
									<button className={`${goldBtn} mt-2 w-fit !px-5 !py-2.5`} style={{ backgroundColor: GOLD }} onClick={() => scrollToId("book")}>
										Check availability <ArrowRight className="size-4" />
									</button>
								</div>
							</article>
						))}
					</div>
				</div>
			</section>

			{/* Experiences */}
			<section id="experiences" className="scroll-mt-24 py-24">
				<div className="mx-auto max-w-6xl px-6">
					<SectionTitle eyebrow="Do less, beautifully" title="Experiences" />
					<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
						{[
							{ icon: Waves, title: "Private shoreline", body: "A quiet stretch of coast reserved for guests — sunrise swims and long, empty walks." },
							{ icon: Sparkles, title: "In-villa spa", body: "Therapists come to you. Oils, sea air, and nowhere to be afterwards." },
							{ icon: Wine, title: "Golden-hour bar", body: "Cocktails and coconut water at the pool bar as the light turns." },
							{ icon: UtensilsCrossed, title: "Dining after dark", body: "A signature kitchen and in-villa dining, from breakfast to midnight." },
						].map((x) => (
							<div key={x.title} className="rounded-2xl border border-[#eee9df] bg-white p-6">
								<x.icon className="mb-4 size-6" style={{ color: GOLD }} />
								<h3 className="font-display text-lg">{x.title}</h3>
								<p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>{x.body}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Dining */}
			{site?.dining?.length ? (
				<section id="dining" className="scroll-mt-24 bg-[#141210] py-24 text-white">
					<div className="mx-auto max-w-6xl px-6">
						<div className="mb-10 text-center">
							<p className="mb-3 text-[0.7rem] uppercase tracking-[0.35em]" style={{ color: GOLD }}>Taste</p>
							<h2 className="font-display text-3xl font-light sm:text-4xl">Dining</h2>
						</div>
						<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
							{site.dining.map((d) => (
								<div key={d.outlet_name} className="rounded-2xl border border-white/10 bg-white/5 p-6">
									<p className="text-[0.68rem] uppercase tracking-widest" style={{ color: GOLD }}>{d.outlet_type}</p>
									<h3 className="font-display mt-2 text-xl">{d.outlet_name}</h3>
									<p className="mt-2 text-sm leading-6 text-white/60">
										{d.outlet_type === "In-Room Dining"
											? "The full kitchen, brought to your villa — any hour."
											: d.outlet_type?.toLowerCase().includes("bar")
											? "Sundowners, small plates, and the sound of the water."
											: "Coastal ingredients, cooked simply and served slowly."}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>
			) : null}

			{/* Gallery */}
			{site?.gallery?.length ? (
				<section className="py-24">
					<div className="mx-auto max-w-6xl px-6">
						<SectionTitle eyebrow="Moments" title="The gallery" />
						<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
							{site.gallery.map((src, i) => (
								<div key={i} className={`overflow-hidden rounded-xl bg-[#efeae1] ${i % 5 === 0 ? "col-span-2 row-span-2" : ""}`}>
									<img src={src} alt="" className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" loading="lazy" />
								</div>
							))}
						</div>
					</div>
				</section>
			) : null}

			{/* Contact / footer */}
			<footer id="contact" className="scroll-mt-24 border-t border-[#eee9df] bg-white">
				<div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-3">
					<div>
						<Wordmark />
						<p className="mt-4 max-w-xs text-sm leading-6" style={{ color: MUTED }}>
							A private coastal retreat of signature arched villas. Reserve online — we hold your villa
							and confirm personally.
						</p>
					</div>
					<div className="flex flex-col gap-3 text-sm" style={{ color: MUTED }}>
						<h3 className="font-medium" style={{ color: INK }}>Find us</h3>
						{site?.address ? <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" style={{ color: GOLD }} /> {site.address}</p> : null}
						{site?.phone ? <p className="flex items-center gap-2"><Phone className="size-4" style={{ color: GOLD }} /> {site.phone}</p> : null}
						{site?.email ? <p className="flex items-center gap-2"><Mail className="size-4" style={{ color: GOLD }} /> {site.email}</p> : null}
					</div>
					<div className="flex flex-col gap-3 text-sm" style={{ color: MUTED }}>
						<h3 className="font-medium" style={{ color: INK }}>Good to know</h3>
						{site?.check_in_time ? <p className="flex items-center gap-2"><Clock className="size-4" style={{ color: GOLD }} /> Check-in from {site.check_in_time.slice(0, 5)}</p> : null}
						{site?.check_out_time ? <p className="flex items-center gap-2"><Clock className="size-4" style={{ color: GOLD }} /> Check-out by {site.check_out_time.slice(0, 5)}</p> : null}
						<button className="mt-1 w-fit underline underline-offset-4 hover:text-[#1c1917]" onClick={props.onLookup}>
							Look up an existing booking
						</button>
					</div>
				</div>
				<div className="border-t border-[#eee9df] py-5 text-center text-xs" style={{ color: MUTED }}>
					© {new Date().getFullYear()} {site?.property_name ?? "THE REEZORT"} · All rights reserved
				</div>
			</footer>
		</div>
	);
}

/* ================= booking journey ================= */

function Rooms(props: { result: SearchResult; busy: boolean; onBack: () => void; onSelect: (o: BookingOffer) => void }) {
	const { result } = props;
	return (
		<div>
			<button className="mb-4 inline-flex items-center gap-1 text-sm hover:text-[#1c1917]" style={{ color: MUTED }} onClick={props.onBack}>
				<ArrowLeft className="size-4" /> Back to the resort
			</button>
			<div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-[#e7e2d9] pb-4">
				<h2 className="font-display text-3xl font-light">Choose your villa</h2>
				<span className="text-sm" style={{ color: MUTED }}>
					{prettyDate(result.arrival_date)} – {prettyDate(result.departure_date)} · {result.nights} night{result.nights === 1 ? "" : "s"}
				</span>
			</div>
			{result.offers.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-[#d8d2c6] py-20 text-center text-sm" style={{ color: MUTED }}>
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
										<p className="mt-1 flex items-center gap-1 text-xs" style={{ color: MUTED }}>
											<Users className="size-3" /> Sleeps {o.max_occupancy || "—"} · {o.available_count} left
										</p>
									</div>
									<div className="text-right">
										<div className="font-display text-xl">{inr(o.total_amount)}</div>
										<div className="text-[0.7rem]" style={{ color: MUTED }}>total · {result.nights}n</div>
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
				<button className="mb-4 inline-flex items-center gap-1 text-sm hover:text-[#1c1917]" style={{ color: MUTED }} onClick={props.onBack}>
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
				<p className="mt-3 text-xs" style={{ color: MUTED }}>
					We'll hold your villa and email a confirmation with a secure deposit link. No charge is made now.
				</p>
			</div>

			<aside className="h-fit overflow-hidden rounded-2xl border border-[#e7e2d9] bg-white shadow-sm">
				<div className="aspect-[4/3] bg-[#efeae1]">
					{offer.image ? <img src={offer.image} alt={offer.room_type_name} className="h-full w-full object-cover" /> : null}
				</div>
				<div className="flex flex-col gap-2 p-5 text-sm">
					<h3 className="font-display text-lg">{offer.room_type_name}</h3>
					<div className="flex justify-between" style={{ color: MUTED }}>
						<span>Dates</span>
						<span style={{ color: INK }}>{prettyDate(result.arrival_date)} – {prettyDate(result.departure_date)}</span>
					</div>
					<div className="flex justify-between" style={{ color: MUTED }}>
						<span>Nights</span>
						<span style={{ color: INK }}>{result.nights}</span>
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

function Done({
	confirmation,
	booker,
	onHome,
}: {
	confirmation: BookingRequestResult;
	booker: { full_name: string; email: string; phone: string };
	onHome: () => void;
}) {
	const [payBusy, setPayBusy] = useState(false);
	const [payError, setPayError] = useState<string | null>(null);
	const [paid, setPaid] = useState<GuestDepositResult | null>(null);

	async function payDeposit() {
		setPayError(null);
		setPayBusy(true);
		try {
			const order = await guestDepositOrder(confirmation.reference, booker.email);
			const result = await openRazorpayCheckout({
				order,
				guestName: booker.full_name,
				guestEmail: booker.email,
				guestPhone: booker.phone,
				description: `Deposit · ${confirmation.reference}`,
			});
			const captured = await guestCaptureDeposit({
				reference: confirmation.reference,
				email: booker.email,
				razorpay_order_id: result.order_id,
				razorpay_payment_id: result.payment_id,
				razorpay_signature: result.signature,
			});
			setPaid(captured);
		} catch (e) {
			const msg = errMessage(e);
			if (!msg.toLowerCase().includes("cancel")) setPayError(msg);
		} finally {
			setPayBusy(false);
		}
	}

	return (
		<div className="mx-auto max-w-xl py-10 text-center">
			<div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: `${GOLD}1a`, color: GOLD }}>
				<Check className="size-8" />
			</div>
			<h2 className="font-display text-3xl font-light">{paid ? "Your stay is secured" : "Your villa is held"}</h2>
			<p className="mx-auto mt-3 max-w-md text-sm" style={{ color: MUTED }}>
				{paid ? (
					<>Deposit of <strong>{inr(paid.amount)}</strong> received — thank you, {confirmation.guest_name}. We'll
					confirm your <strong>{confirmation.room_type_name}</strong> and be in touch shortly.</>
				) : (
					<>Thank you, {confirmation.guest_name}. We've reserved the <strong>{confirmation.room_type_name}</strong> for{" "}
					{prettyDate(confirmation.arrival_date)} – {prettyDate(confirmation.departure_date)}. Secure it now with a
					deposit, or we'll email you a payment link.</>
				)}
			</p>
			<div className="mx-auto mt-8 w-fit rounded-2xl border border-[#e7e2d9] bg-white px-10 py-6 shadow-sm">
				<p className="text-[0.7rem] uppercase tracking-widest" style={{ color: MUTED }}>Booking reference</p>
				<p className="font-display mt-1 text-2xl">{confirmation.reference}</p>
				<p className="mt-3 text-sm" style={{ color: MUTED }}>
					Estimated total <span className="font-medium" style={{ color: INK }}>{inr(confirmation.estimated_total)}</span>
				</p>
				{paid ? (
					<p className="mt-1 text-sm" style={{ color: MUTED }}>
						Deposit paid <span className="font-medium" style={{ color: INK }}>{inr(paid.deposit_paid)}</span>
					</p>
				) : null}
			</div>
			{payError ? <div className="mx-auto mt-5 max-w-md"><Notice text={payError} /></div> : null}
			{!paid ? (
				<button className={`${goldBtn} mt-7`} style={{ backgroundColor: GOLD }} onClick={payDeposit} disabled={payBusy} data-testid="book-pay-deposit">
					{payBusy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Secure with deposit
				</button>
			) : null}
			<div>
				<button className="mt-6 text-sm underline underline-offset-4 hover:text-[#1c1917]" style={{ color: MUTED }} onClick={onHome}>
					Back to the resort
				</button>
			</div>
		</div>
	);
}

function Lookup() {
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
		<div className="mx-auto max-w-2xl">
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
						<dt style={{ color: MUTED }}>Guest</dt><dd className="text-right">{found.guest_name ?? "—"}</dd>
						<dt style={{ color: MUTED }}>Villa</dt><dd className="text-right">{found.room_type_name ?? "—"}</dd>
						<dt style={{ color: MUTED }}>Dates</dt>
						<dd className="text-right">{found.arrival_date ? `${prettyDate(found.arrival_date)} – ${prettyDate(found.departure_date ?? found.arrival_date)}` : "—"}</dd>
						<dt style={{ color: MUTED }}>Deposit</dt><dd className="text-right">{found.deposit_status ?? "—"}</dd>
						<dt style={{ color: MUTED }}>Estimated total</dt><dd className="text-right">{inr(found.total_estimated_amount)}</dd>
					</dl>
				</div>
			) : null}
		</div>
	);
}
