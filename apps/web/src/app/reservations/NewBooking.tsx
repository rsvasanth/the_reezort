/**
 * New booking — full-page booking flow: search availability → select room type →
 * guest details → confirm. Dates are validated client-side so search can't 400.
 */

import { useEffect, useState } from "react";
import { Field } from "@/components/workspace/field";
import { AnimatePresence, motion } from "motion/react";
import { BedDouble, Calendar, Check, ChevronDown, Gift, Info, Loader2, Search, Tag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { WorkspacePage } from "@/components/workspace/workspace";
import { formatCurrency } from "@/components/folio/folio-format";
import {
	FolioApiError,
	createHold,
	ensureBookingFolio,
	listRatePlans,
	searchAvailability,
	type AvailabilityOffer,
	type NightlyBreakdown,
	type PackageOffer,
	type RatePlan,
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
	const [planCode, setPlanCode] = useState<string>("");
	const [plans, setPlans] = useState<RatePlan[]>([]);
	const [searching, setSearching] = useState(false);
	const [property, setProperty] = useState("");
	const [offers, setOffers] = useState<AvailabilityOffer[] | null>(null);
	const [roomType, setRoomType] = useState("");
	const [expandedOffer, setExpandedOffer] = useState<string | null>(null);
	const [guest, setGuest] = useState({ full_name: "", email: "", phone: "" });
	const [confirming, setConfirming] = useState(false);

	// Preload rate plans once so the picker is ready before the first search.
	useEffect(() => {
		listRatePlans().then((res) => setPlans(res.plans)).catch(() => setPlans([]));
	}, []);

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
			const result = await searchAvailability(arrival, departure, parseInt(adults, 10) || 2, planCode || undefined);
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
			// Step 1: create the Hold (no deposit needed yet — status = Hold).
			const hold = await createHold(property, arrival, departure, roomType, parseInt(adults, 10) || 2);
			// Step 2: bootstrap the customer + folio on the Hold so the Reservation
			// Detail screen opens with the deposit sheet ready to go (booker prefilled).
			await ensureBookingFolio({
				reservation: hold.reservation,
				booker: {
					full_name: guest.full_name,
					email: guest.email || undefined,
					phone: guest.phone || undefined,
				},
			}).catch(() => {}); // non-fatal — the detail screen can bootstrap itself
			toast.success("Held — take the deposit to confirm", { description: hold.reservation });
			go(`#/reservations/${encodeURIComponent(hold.reservation)}`);
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Could not create the booking", { description: detail });
		} finally {
			setConfirming(false);
		}
	}

	return (
		<WorkspacePage badge="Reservations" title="New booking" onBack={() => go("#/reservations")}>
			{/* 1 — Stay */}
			<Card>
				<CardContent className="flex flex-col gap-4 p-6">
					<h3 className="text-sm font-semibold">1 · Stay dates &amp; plan</h3>
					<div className="grid gap-4 sm:grid-cols-5">
						<Field label="Arrival"><Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} data-testid="b-arrival" /></Field>
						<Field label="Departure"><Input type="date" value={departure} min={arrival} onChange={(e) => setDeparture(e.target.value)} data-testid="b-departure" /></Field>
						<Field label="Adults"><Input type="number" min="1" value={adults} onChange={(e) => setAdults(e.target.value)} /></Field>
						<Field label="Rate plan">
							<Select value={planCode || "auto"} onValueChange={(v) => setPlanCode(v === "auto" ? "" : v)}>
								<SelectTrigger data-testid="b-plan"><SelectValue placeholder="Best rate" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Best available rate</SelectItem>
									{plans.map((p) => (
										<SelectItem key={p.code} value={p.code}>
											{p.plan_name}
											{p.refundable ? " · Refundable" : " · Non-refundable"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<div className="flex items-end">
							<Button onClick={doSearch} disabled={searching || !datesValid} data-testid="b-search" className="w-full">
								{searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Check
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
							<div className="flex flex-col gap-3" data-testid="offers">
								{offers.map((o) => {
									const isSelected = roomType === o.room_type;
									const isExpanded = expandedOffer === o.room_type;
									const hasBreakdown = o.nightly_breakdown && o.nightly_breakdown.length > 0;
									return (
										<motion.div
											key={o.room_type}
											whileHover={{ y: -1 }}
											data-testid={`offer-${o.room_type}`}
											className={[
												"flex flex-col gap-2 rounded-lg border p-4",
												isSelected ? "border-foreground bg-muted" : "border-border hover:bg-muted/50",
											].join(" ")}
										>
											<button
												type="button"
												onClick={() => setRoomType(o.room_type)}
												className="flex flex-wrap items-center justify-between gap-2 text-left"
											>
												<div className="flex flex-col gap-1">
													<span className="flex items-center gap-2 font-medium">
														<BedDouble className="size-4" />
														{o.room_type}
														{isSelected ? <Check className="size-4 text-primary" /> : null}
													</span>
													<div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
														<span>{o.available_count} available</span>
														{o.applied_plan ? (
															<Badge variant="outline" className="ml-1 gap-1 text-[10px]">
																<Tag className="size-3" />
																{o.applied_plan.name}
																{o.applied_plan.refundable ? " · Refundable" : " · Non-refundable"}
															</Badge>
														) : (
															<Badge variant="outline" className="ml-1 text-[10px]">Best rate</Badge>
														)}
														{o.season_uplift_summary ? (
															<Badge variant="secondary" className="text-[10px]">
																{o.season_uplift_summary}
															</Badge>
														) : null}
													</div>
												</div>
												<div className="flex flex-col items-end gap-0.5">
													<span className="text-lg font-medium">
														{typeof o.per_room_estimated_amount === "number"
															? formatCurrency(o.per_room_estimated_amount, "INR")
															: (typeof o.estimated_amount === "number" ? formatCurrency(o.estimated_amount, "INR") : "—")}
													</span>
													{o.base_rate ? (
														<span className="text-[11px] text-muted-foreground">
															Base {formatCurrency(o.base_rate, "INR")}/night
														</span>
													) : null}
												</div>
											</button>

											{o.cancellation_policy_summary ? (
												<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
													<Info className="size-3" />
													{o.cancellation_policy_summary}
												</div>
											) : null}

											{hasBreakdown ? (
												<div className="flex flex-col gap-2">
													<button
														type="button"
														onClick={() => setExpandedOffer(isExpanded ? null : o.room_type)}
														className="flex items-center gap-1 self-start text-xs text-primary hover:underline"
														data-testid={`breakdown-${o.room_type}`}
													>
														<Calendar className="size-3" />
														{isExpanded ? "Hide" : "Show"} rate breakdown ({o.nightly_breakdown.length} nights)
														<ChevronDown className={`size-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
													</button>
													<AnimatePresence>
														{isExpanded ? (
															<motion.div
																initial={{ opacity: 0, height: 0 }}
																animate={{ opacity: 1, height: "auto" }}
																exit={{ opacity: 0, height: 0 }}
																transition={{ duration: 0.2 }}
																className="overflow-hidden"
															>
																<NightlyBreakdownTable breakdown={o.nightly_breakdown} />
															</motion.div>
														) : null}
													</AnimatePresence>
												</div>
											) : null}

											{o.packages && o.packages.length > 0 ? (
												<PackageSuggestions packages={o.packages} />
											) : null}
										</motion.div>
									);
								})}
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
						<div className="flex flex-wrap items-center gap-3">
							<Button onClick={confirm} disabled={confirming || !guest.full_name} data-testid="b-confirm">
								{confirming ? <Loader2 className="size-4 animate-spin" /> : null} Reserve &amp; take deposit
							</Button>
							<Badge variant="secondary">{roomType}</Badge>
							<span className="text-xs text-muted-foreground">Next: deposit → confirm on the reservation screen</span>
						</div>
					</CardContent>
				</Card>
			) : null}
		</WorkspacePage>
	);
}


function NightlyBreakdownTable({ breakdown }: { breakdown: NightlyBreakdown[] }) {
	const total = breakdown.reduce((sum, n) => sum + n.rate, 0);
	return (
		<div className="rounded-md border bg-background/60">
			<table className="w-full text-xs">
				<thead className="bg-muted/50 text-muted-foreground">
					<tr>
						<th className="px-3 py-1.5 text-left font-medium">Night</th>
						<th className="px-3 py-1.5 text-left font-medium">Tags</th>
						<th className="px-3 py-1.5 text-right font-medium">Rate</th>
					</tr>
				</thead>
				<tbody>
					{breakdown.map((n) => (
						<tr key={n.date} className="border-t">
							<td className="px-3 py-1.5">{n.date}</td>
							<td className="px-3 py-1.5">
								<div className="flex flex-wrap gap-1">
									{n.season_code ? (
										<Badge variant="outline" className="text-[10px]">
											{n.season_code}
											{typeof n.season_pct === "number" ? ` ${n.season_pct >= 0 ? "+" : ""}${n.season_pct}%` : ""}
										</Badge>
									) : null}
									{n.weekend ? <Badge variant="secondary" className="text-[10px]">Weekend</Badge> : null}
								</div>
							</td>
							<td className="px-3 py-1.5 text-right font-medium">{formatCurrency(n.rate, "INR")}</td>
						</tr>
					))}
					<tr className="border-t bg-muted/30">
						<td className="px-3 py-1.5 font-medium" colSpan={2}>Total (1 room)</td>
						<td className="px-3 py-1.5 text-right font-semibold">{formatCurrency(total, "INR")}</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}


function PackageSuggestions({ packages }: { packages: PackageOffer[] }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1 text-xs text-muted-foreground">
				<Gift className="size-3" />
				{packages.length} package{packages.length === 1 ? "" : "s"} available
			</div>
			<div className="flex flex-wrap gap-2">
				{packages.map((p) => (
					<div key={p.code} className="flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1 text-xs">
						<span className="font-medium">{p.package_name}</span>
						<span className="text-muted-foreground">{formatCurrency(p.package_price, p.currency || "INR")}</span>
						{p.inclusions_summary ? (
							<span className="text-muted-foreground">· {p.inclusions_summary}</span>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}
