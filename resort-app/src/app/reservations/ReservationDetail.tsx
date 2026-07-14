/**
 * Reservation detail — full-page workspace (header card + KPIs + sections).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, CalendarDays, BedDouble, BadgeCheck, CreditCard, LogIn, ShieldAlert, CalendarClock, UserX, Undo2, Building2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
import { Field } from "@/components/workspace/field";
import { WorkspacePage, RecordHeader, KpiStrip } from "@/components/workspace/workspace";
import { formatCurrency } from "@/components/folio/folio-format";
import {
	FolioApiError,
	amendReservation,
	cancelReservation,
	confirmReservation,
	ensureBookingFolio,
	getReservation,
	getReservationDepositState,
	markNoShow,
	recordBookingDeposit,
	reverseNoShow,
	setReservationBillTo,
	type ReservationDepositState,
	type ReservationDetail as Detail,
} from "@/lib/reservation-api";
import { payDepositViaRazorpay } from "@/lib/folio-api";

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
	const [depositState, setDepositState] = useState<ReservationDepositState | null>(null);
	const [depositOpen, setDepositOpen] = useState(false);
	const [amendOpen, setAmendOpen] = useState(false);
	const [noShowMode, setNoShowMode] = useState<null | "mark" | "reverse">(null);
	const [billToOpen, setBillToOpen] = useState(false);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	const reload = useCallback(async () => {
		try {
			const [d, s] = await Promise.all([
				getReservation(reservation),
				getReservationDepositState(reservation).catch(() => null),
			]);
			setDetail(d);
			setDepositState(s);
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

	async function confirmBooking() {
		if (!detail) return;
		setBusy(true);
		try {
			const primary = detail.guests?.[0];
			const booker = {
				full_name: primary?.guest_name ?? detail.guest,
				email: primary?.email ?? undefined,
				phone: primary?.phone ?? undefined,
			};
			await confirmReservation(reservation, booker);
			toast.success("Booking confirmed", { description: reservation });
			await reload();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Could not confirm booking", { description: msg });
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
	const isUnconfirmed = ["Hold", "Draft", "Deposit Pending", "Quoted"].includes(detail.status);
	const canConfirm = isUnconfirmed && (!depositState || depositState.met);
	const canAmend = ["Hold", "Quoted", "Draft", "Deposit Pending", "Confirmed", "Modified", "Waitlisted"].includes(
		detail.status,
	);
	const arrivalPassed = !!detail.arrival_date && detail.arrival_date <= new Date().toISOString().slice(0, 10);
	const canNoShow = ["Confirmed", "Modified", "Deposit Pending"].includes(detail.status) && arrivalPassed;
	const isNoShow = detail.status === "No Show";

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
					{ label: "Customer", value: detail.erpnext_customer_name ?? "—" },
					...(detail.bill_to_customer_name
						? [{ label: "Bill-to", value: detail.bill_to_customer_name }]
						: []),
				]}
				actions={
					<>
						{depositState && depositState.required_amount > 0 && depositState.outstanding_amount > 0 ? (
							<Button size="sm" variant="default" onClick={() => setDepositOpen(true)} data-testid="res-take-deposit">
								<CreditCard className="size-4" /> Take deposit
							</Button>
						) : null}
						{canConfirm ? (
							<Button size="sm" onClick={confirmBooking} disabled={busy} data-testid="res-confirm">
								{busy ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />} Confirm booking
							</Button>
						) : null}
						{canCheckIn ? (
							<Button size="sm" onClick={() => go(`#/check-in/${encodeURIComponent(reservation)}`)} data-testid="res-checkin">
								<LogIn className="size-4" /> Check in
							</Button>
						) : null}
						{canAmend ? (
							<Button size="sm" variant="outline" onClick={() => setAmendOpen(true)} data-testid="res-amend">
								<CalendarClock className="size-4" /> Amend
							</Button>
						) : null}
						{canNoShow ? (
							<Button size="sm" variant="outline" onClick={() => setNoShowMode("mark")} data-testid="res-no-show">
								<UserX className="size-4" /> No-show
							</Button>
						) : null}
						{isNoShow ? (
							<Button size="sm" variant="outline" onClick={() => setNoShowMode("reverse")} data-testid="res-reverse-no-show">
								<Undo2 className="size-4" /> Reverse no-show
							</Button>
						) : null}
						<Button size="sm" variant="outline" onClick={() => setBillToOpen(true)} data-testid="res-bill-to">
							<Building2 className="size-4" /> Bill-to
						</Button>
						{canCancel ? (
							<Button size="sm" variant="outline" onClick={cancel} disabled={busy}>Cancel reservation</Button>
						) : null}
					</>
				}
			/>

			{depositState && depositState.required_amount > 0 ? (
				<DepositGatePanel
					state={depositState}
					currency={cur}
					onTakeDeposit={() => setDepositOpen(true)}
				/>
			) : null}

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

			{depositOpen && depositState ? (
				<TakeDepositSheet
					reservation={reservation}
					state={depositState}
					booker={detail?.guests?.[0]}
					onClose={() => setDepositOpen(false)}
					onRecorded={() => { setDepositOpen(false); void reload(); }}
				/>
			) : null}

			{amendOpen ? (
				<AmendReservationSheet
					reservation={reservation}
					arrival={detail.arrival_date ?? ""}
					departure={detail.departure_date ?? ""}
					onClose={() => setAmendOpen(false)}
					onDone={() => { setAmendOpen(false); void reload(); }}
				/>
			) : null}

			{noShowMode ? (
				<NoShowSheet
					reservation={reservation}
					mode={noShowMode}
					depositStatus={detail.deposit_status ?? null}
					onClose={() => setNoShowMode(null)}
					onDone={() => { setNoShowMode(null); void reload(); }}
				/>
			) : null}

			{billToOpen ? (
				<BillToSheet
					reservation={reservation}
					guestCustomer={detail.erpnext_customer_name}
					currentBillTo={detail.bill_to_customer}
					onClose={() => setBillToOpen(false)}
					onDone={() => { setBillToOpen(false); void reload(); }}
				/>
			) : null}
		</WorkspacePage>
	);
}

// ---------- corporate / TA bill-to ----------

function BillToSheet({
	reservation,
	guestCustomer,
	currentBillTo,
	onClose,
	onDone,
}: {
	reservation: string;
	guestCustomer: string | null;
	currentBillTo: string | null;
	onClose: () => void;
	onDone: () => void;
}) {
	const [customer, setCustomer] = useState(currentBillTo ?? "");
	const [busy, setBusy] = useState(false);

	async function save(value: string | null) {
		setBusy(true);
		try {
			const res = await setReservationBillTo(reservation, value);
			toast.success(value ? "Bill-to set" : "Bill-to cleared", {
				description: res.bill_to_customer_name ?? `Bills to guest (${guestCustomer ?? "own account"})`,
			});
			onDone();
		} catch (error) {
			toast.error("Could not update bill-to", { description: error instanceof FolioApiError ? error.message : String(error) });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="bill-to-sheet">
				<SheetHeader>
					<SheetTitle>Billing customer</SheetTitle>
					<SheetDescription>
						Route this reservation's charges to a corporate or travel-agent account. Leave empty to bill the guest directly.
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 p-4">
					<div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
						Guest account: <span className="font-medium text-foreground">{guestCustomer ?? "—"}</span>
					</div>
					<div className="flex flex-col gap-1">
						<Label>Bill-to Customer (ERPNext Customer ID)</Label>
						<Input
							value={customer}
							onChange={(e) => setCustomer(e.target.value)}
							placeholder="e.g. CUST-00042 (corporate / TA)"
							data-testid="bill-to-input"
						/>
					</div>
				</div>
				<SheetFooter>
					<Button onClick={() => save(customer.trim() || null)} disabled={busy} data-testid="bill-to-save">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />} Save
					</Button>
					{currentBillTo ? (
						<Button variant="outline" onClick={() => save(null)} disabled={busy}>Clear (bill guest)</Button>
					) : (
						<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					)}
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ---------- amend reservation (dates) ----------

function AmendReservationSheet({
	reservation,
	arrival,
	departure,
	onClose,
	onDone,
}: {
	reservation: string;
	arrival: string;
	departure: string;
	onClose: () => void;
	onDone: () => void;
}) {
	const [newArrival, setNewArrival] = useState(arrival);
	const [newDeparture, setNewDeparture] = useState(departure);
	const [reason, setReason] = useState("");
	const [override, setOverride] = useState(false);
	const [busy, setBusy] = useState(false);

	async function submit() {
		if (!reason.trim()) {
			toast.error("An amendment reason is required.");
			return;
		}
		if (newDeparture <= newArrival) {
			toast.error("Departure must be after arrival.");
			return;
		}
		setBusy(true);
		try {
			const res = await amendReservation({
				reservation,
				changes: { arrival_date: newArrival, departure_date: newDeparture },
				reason: reason.trim(),
				allow_override: override,
			});
			toast.success("Reservation amended", { description: `Now ${res.status} · ${formatCurrency(res.total_estimated_amount, "INR")}` });
			onDone();
		} catch (error) {
			toast.error("Could not amend", { description: error instanceof FolioApiError ? error.message : String(error) });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="amend-sheet">
				<SheetHeader>
					<SheetTitle>Amend reservation</SheetTitle>
					<SheetDescription>Change the stay dates. Availability is re-checked for the new window.</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 p-4">
					<div className="flex gap-3">
						<div className="flex flex-1 flex-col gap-1">
							<Label>Arrival</Label>
							<Input type="date" value={newArrival} onChange={(e) => setNewArrival(e.target.value)} data-testid="amend-arrival" />
						</div>
						<div className="flex flex-1 flex-col gap-1">
							<Label>Departure</Label>
							<Input type="date" value={newDeparture} onChange={(e) => setNewDeparture(e.target.value)} data-testid="amend-departure" />
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<Label>Reason</Label>
						<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" data-testid="amend-reason" />
					</div>
					<label className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
						Override availability (manager)
					</label>
				</div>
				<SheetFooter>
					<Button onClick={submit} disabled={busy} data-testid="amend-submit">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />} Save amendment
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ---------- no-show / reverse ----------

function NoShowSheet({
	reservation,
	mode,
	depositStatus,
	onClose,
	onDone,
}: {
	reservation: string;
	mode: "mark" | "reverse";
	depositStatus: string | null;
	onClose: () => void;
	onDone: () => void;
}) {
	const [reason, setReason] = useState("");
	const [forfeit, setForfeit] = useState(true);
	const [busy, setBusy] = useState(false);
	const hasDeposit = depositStatus === "Paid" || depositStatus === "Partially Paid";

	async function submit() {
		if (!reason.trim()) {
			toast.error("A reason is required.");
			return;
		}
		setBusy(true);
		try {
			if (mode === "mark") {
				const res = await markNoShow({ reservation, reason: reason.trim(), forfeit_deposit: forfeit });
				toast.success("Marked no-show", {
					description: res.financial_handoff_required ? "Deposit forfeited — fee posts to billing." : `Deposit ${res.deposit_status}`,
				});
			} else {
				await reverseNoShow(reservation, reason.trim());
				toast.success("No-show reversed", { description: "Reservation back to Confirmed." });
			}
			onDone();
		} catch (error) {
			toast.error(mode === "mark" ? "Could not mark no-show" : "Could not reverse", {
				description: error instanceof FolioApiError ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="no-show-sheet">
				<SheetHeader>
					<SheetTitle>{mode === "mark" ? "Mark no-show" : "Reverse no-show"}</SheetTitle>
					<SheetDescription>
						{mode === "mark"
							? "Release the room inventory and record the no-show. Deposit handling per policy."
							: "Return this reservation to Confirmed (manager action)."}
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 p-4">
					<div className="flex flex-col gap-1">
						<Label>Reason</Label>
						<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" data-testid="no-show-reason" />
					</div>
					{mode === "mark" && hasDeposit ? (
						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} />
							Forfeit the {depositStatus?.toLowerCase()} deposit
						</label>
					) : null}
				</div>
				<SheetFooter>
					<Button onClick={submit} disabled={busy} variant={mode === "mark" ? "destructive" : "default"} data-testid="no-show-submit">
						{busy ? <Loader2 className="size-4 animate-spin" /> : mode === "mark" ? <UserX className="size-4" /> : <Undo2 className="size-4" />}
						{mode === "mark" ? "Confirm no-show" : "Reverse"}
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ---------- deposit gate panel ----------

function DepositGatePanel({
	state,
	currency,
	onTakeDeposit,
}: {
	state: ReservationDepositState;
	currency: string;
	onTakeDeposit: () => void;
}) {
	const met = state.met;
	return (
		<Card>
			<CardContent className="flex flex-col gap-3 py-5">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						{met ? (
							<Badge className="gap-1"><BadgeCheck className="size-3.5" /> Deposit gate met</Badge>
						) : (
							<Badge variant="destructive" className="gap-1"><ShieldAlert className="size-3.5" /> Deposit required to confirm</Badge>
						)}
						<span className="text-sm text-muted-foreground">Policy: <strong>{state.deposit_policy}</strong> ({state.required_percent}% of estimate)</span>
					</div>
					{!met ? (
						<Button size="sm" onClick={onTakeDeposit} data-testid="gate-take-deposit">
							<CreditCard className="size-4" /> Take {formatCurrency(state.outstanding_amount, currency)}
						</Button>
					) : null}
				</div>
				<div className="grid gap-3 sm:grid-cols-4">
					<Stat label="Required" value={formatCurrency(state.required_amount, currency)} />
					<Stat label="Paid" value={formatCurrency(state.paid_amount, currency)} accent={state.paid_amount > 0 ? "good" : undefined} />
					<Stat label="Outstanding" value={formatCurrency(state.outstanding_amount, currency)} accent={state.outstanding_amount > 0 ? "warn" : "good"} />
					<Stat label="Total estimate" value={formatCurrency(state.total_estimated_amount, currency)} />
				</div>
			</CardContent>
		</Card>
	);
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "good" | "warn" | "danger" }) {
	const tone = accent === "good"
		? "text-[#0e6027] dark:text-[#6fdc8c]"
		: accent === "warn"
			? "text-[#684e00] dark:text-[#f1c21b]"
			: accent === "danger"
				? "text-destructive"
				: "";
	return (
		<div>
			<div className="text-xs uppercase text-muted-foreground">{label}</div>
			<div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
		</div>
	);
}

// ---------- take deposit sheet ----------

const MODES = ["Razorpay (card / UPI)", "Cash", "Credit Card", "Bank Transfer"];

function TakeDepositSheet({
	reservation,
	state,
	booker,
	onClose,
	onRecorded,
}: {
	reservation: string;
	state: ReservationDepositState;
	booker?: { guest_name: string; email: string | null; phone: string | null };
	onClose: () => void;
	onRecorded: () => void;
}) {
	const [fullName, setFullName] = useState(booker?.guest_name ?? "");
	const [email, setEmail] = useState(booker?.email ?? "");
	const [phone, setPhone] = useState(booker?.phone ?? "");
	const [amount, setAmount] = useState(String(state.outstanding_amount));
	const [mode, setMode] = useState<string>("Razorpay (card / UPI)");
	const [busy, setBusy] = useState(false);

	async function take() {
		const amt = parseFloat(amount);
		if (!fullName.trim()) { toast.error("Booker name is required"); return; }
		if (!amt || amt <= 0) { toast.error("Enter a deposit amount"); return; }
		setBusy(true);
		try {
			const booker = { full_name: fullName, email: email || undefined, phone: phone || undefined };
			if (mode === "Razorpay (card / UPI)") {
				// Bootstrap the customer/folio first, then open the Razorpay modal against the folio.
				const { folio } = await ensureBookingFolio({ reservation, booker });
				await payDepositViaRazorpay({
					guest_folio: folio,
					amount: amt,
					guestName: fullName,
					guestEmail: email || undefined,
					guestPhone: phone || undefined,
				});
			} else {
				await recordBookingDeposit({ reservation, booker, amount: amt, mode_of_payment: mode });
			}
			toast.success(`Deposit of ${formatCurrency(amt, state.currency)} recorded`);
			onRecorded();
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Could not record deposit";
			if (msg === "Payment cancelled") toast.info("Payment cancelled");
			else toast.error("Could not record deposit", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Take booking deposit</SheetTitle>
					<SheetDescription>
						{formatCurrency(state.required_amount, state.currency)} required to confirm ({state.required_percent}% of {formatCurrency(state.total_estimated_amount, state.currency)}).
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 py-4">
					<Field label="Booker name" required>
						<Input value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="dep-name" />
					</Field>
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
						<Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." /></Field>
					</div>
					<div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
						<Field label={`Amount (${state.currency})`}>
							<Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="dep-amount" />
						</Field>
						<Field label="Mode">
							<Select value={mode} onValueChange={setMode}>
								<SelectTrigger><SelectValue /></SelectTrigger>
								<SelectContent>{MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
							</Select>
						</Field>
					</div>
				</div>
				<SheetFooter>
					<Button onClick={take} disabled={busy} data-testid="dep-take">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />} Take deposit
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
