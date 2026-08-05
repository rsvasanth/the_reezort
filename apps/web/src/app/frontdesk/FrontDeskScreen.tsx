/**
 * Front Desk — arrivals (check in) + in-house (open folio / check out).
 * Drives the existing check_in / check_out PMS endpoints. Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, CalendarMinus, CalendarPlus, Clock, Loader2, LogIn, LogOut, MoreHorizontal, ReceiptText, Shirt, UserX, UtensilsCrossed, Wine, ClipboardCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { IrdOrderSheet } from "@/components/folio/ird-order-sheet";
import { MinibarSheet } from "@/components/folio/minibar-sheet";
import { LinenSheet } from "@/components/housekeeping/linen-sheet";
import { RoomThumb } from "@/components/property/room-thumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OccupancyTimeline } from "@/components/occupancy-timeline";
import { WorkspacePage } from "@/components/workspace/workspace";
import {
	FolioApiError,
	checkOut,
	extendStay,
	getFrontDeskBoard,
	listVacantRoomsForMove,
	moveGuestRoom,
	requestLateCheckout,
	approveLateCheckout,
	listLateCheckoutRequests,
	listNoShowEligible,
	markNoShow,
	getCheckoutReadiness,
	earlyDeparture,
	type ArrivalReadiness,
	type FrontDeskBoard,
	type FrontDeskInHouse,
	type RoomMoveReason,
	type VacantRoom,
	type LateCheckoutRequest,
	type NoShowEligible,
	type CheckoutReadiness,
	type LateCheckoutChargePolicy,
} from "@/lib/pms-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.message : String(error);
	toast.error(fallback, { description: detail });
}

export default function FrontDeskScreen() {
	const [board, setBoard] = useState<FrontDeskBoard | null>(null);
	const [loading, setLoading] = useState(true);
	const [extending, setExtending] = useState<FrontDeskInHouse | null>(null);
	const [moving, setMoving] = useState<FrontDeskInHouse | null>(null);
	const [minibar, setMinibar] = useState<FrontDeskInHouse | null>(null);
	const [linen, setLinen] = useState<FrontDeskInHouse | null>(null);
	const [ird, setIrd] = useState<FrontDeskInHouse | null>(null);
	const [checkingOut, setCheckingOut] = useState<string | null>(null);
	const [lateCheckout, setLateCheckout] = useState<FrontDeskInHouse | null>(null);
	const [earlyDep, setEarlyDep] = useState<FrontDeskInHouse | null>(null);
	const [readiness, setReadiness] = useState<FrontDeskInHouse | null>(null);
	const [noShows, setNoShows] = useState<NoShowEligible[]>([]);
	const [lateRequests, setLateRequests] = useState<LateCheckoutRequest[]>([]);

	const reload = useCallback(async () => {
		try {
			const [boardData, noShowData, lateData] = await Promise.all([
				getFrontDeskBoard(),
				listNoShowEligible().catch(() => ({ eligible: [] })),
				listLateCheckoutRequests(undefined, "Pending").catch(() => ({ requests: [] })),
			]);
			setBoard(boardData);
			setNoShows(noShowData.eligible);
			setLateRequests(lateData.requests);
		} catch (error) {
			reportError(error, "Could not load the front desk");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	function openFolio(folio: string | null) {
		if (folio) window.location.hash = `#/folio/${folio}`;
	}

	async function handleCheckout(s: FrontDeskInHouse) {
		setCheckingOut(s.stay);
		try {
			const result = await checkOut(s.stay);
			toast.success(`${s.guest} checked out`, {
				description: result.room ? `Room ${result.room} → housekeeping` : undefined,
			});
			await reload();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.message : String(error);
			// Checkout is blocked until the folio is settled — route the agent there.
			if (/settle/i.test(msg)) {
				toast.info("Settle the folio to check out", { description: "Opening the folio…" });
				openFolio(s.folio);
			} else {
				reportError(error, "Checkout failed");
			}
		} finally {
			setCheckingOut(null);
		}
	}

	/*
	 * Due-out is its own queue, not a badge buried in the in-house list. It is the
	 * work with a deadline attached, so it gets its own tab and its own count.
	 */
	const staying = board?.in_house.filter((s) => !s.due_out) ?? [];
	const dueOut = board?.in_house.filter((s) => s.due_out) ?? [];
	const stayActions: StayActions = {
		onExtend: setExtending,
		onEarlyDep: setEarlyDep,
		onLateCheckout: setLateCheckout,
		onMove: setMoving,
		onIrd: setIrd,
		onMinibar: setMinibar,
		onLinen: setLinen,
		onReadiness: setReadiness,
		onOpenFolio: openFolio,
		onCheckout: handleCheckout,
	};

	return (
		<WorkspacePage
			testId="frontdesk-screen"
			badge="Front desk"
			title="Front desk"
			subtitle="Arrivals, in-house guests, and departures."
		>
			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : board ? (
				<Tabs defaultValue="arriving" className="flex flex-1 flex-col gap-4">
					{/*
					 * Tabs, not stacked sections. The queues are peers rather than a sequence,
					 * and stacking them meant scrolling a 14-day grid to reach the list you
					 * came for. Counts sit on the tabs, which is why the KPI cards that used
					 * to head this screen are gone — they restated the same three numbers.
					 */}
					<TabsList>
						<TabsTrigger value="arriving" data-testid="tab-arriving">
							Arriving <TabCount n={board.counts.arrivals} />
						</TabsTrigger>
						<TabsTrigger value="inhouse" data-testid="tab-inhouse">
							In-house <TabCount n={staying.length} />
						</TabsTrigger>
						<TabsTrigger value="dueout" data-testid="tab-dueout">
							Due out <TabCount n={dueOut.length} danger={dueOut.length > 0} />
						</TabsTrigger>
						{noShows.length > 0 ? (
							<TabsTrigger value="noshow" data-testid="tab-noshow">
								No-shows <TabCount n={noShows.length} danger />
							</TabsTrigger>
						) : null}
						{lateRequests.length > 0 ? (
							<TabsTrigger value="latecheckout" data-testid="tab-latecheckout">
								Late C/O <TabCount n={lateRequests.length} />
							</TabsTrigger>
						) : null}
						<TabsTrigger value="forecast" data-testid="tab-forecast">Forecast</TabsTrigger>
					</TabsList>

					<TabsContent value="arriving">
						<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Guest</TableHead>
										<TableHead>Room type</TableHead>
										<TableHead>Arrival</TableHead>
										<TableHead>Nights</TableHead>
										<TableHead>Readiness</TableHead>
										<TableHead className="text-right">Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{board.arrivals.length === 0 ? (
										<TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No arrivals pending.</TableCell></TableRow>
									) : (
										board.arrivals.map((a) => (
											<TableRow key={a.reservation} data-testid={`arrival-${a.reservation}`}>
												<TableCell className="font-medium">{a.guest}
													{a.due_today ? <Badge variant="secondary" className="ml-2">Today</Badge> : null}
												</TableCell>
												<TableCell className="text-sm">
													<div className="flex items-center gap-2">
														<RoomThumb image={a.room_type_image} label={a.room_type ?? "?"} size={32} />
														<span>{a.room_type ?? "—"}</span>
													</div>
												</TableCell>
												<TableCell className="text-sm">{a.arrival_date ?? "—"}</TableCell>
												<TableCell className="text-sm">{a.nights ?? "—"}</TableCell>
												<TableCell><ArrivalReadinessBadges readiness={a.readiness} /></TableCell>
												<TableCell className="text-right">
													<Button size="sm" onClick={() => { window.location.hash = `#/check-in/${encodeURIComponent(a.reservation)}`; }} data-testid={`checkin-${a.reservation}`}>
														<LogIn className="size-4" /> Check in
													</Button>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
					</TabsContent>

					<TabsContent value="inhouse">
						<StayTable stays={staying} empty="No in-house guests." actions={stayActions} checkingOut={checkingOut} />
					</TabsContent>

					<TabsContent value="dueout">
						<StayTable stays={dueOut} empty="Nobody is due out." actions={stayActions} checkingOut={checkingOut} />
					</TabsContent>

					{noShows.length > 0 ? (
						<TabsContent value="noshow"><NoShowSection eligible={noShows} onMarked={reload} /></TabsContent>
					) : null}

					{lateRequests.length > 0 ? (
						<TabsContent value="latecheckout"><LateCheckoutSection requests={lateRequests} onActioned={reload} /></TabsContent>
					) : null}

					<TabsContent value="forecast"><OccupancyTimeline /></TabsContent>
				</Tabs>
			) : (
				<Card><CardContent className="py-8 text-sm text-muted-foreground">Could not load the front desk.</CardContent></Card>
			)}

			{extending ? (
				<ExtendSheet stay={extending} onClose={() => setExtending(null)} onExtended={reload} />
			) : null}

			{moving ? (
				<MoveRoomSheet stay={moving} onClose={() => setMoving(null)} onMoved={reload} />
			) : null}

			{minibar ? (
				<MinibarSheet
					open={!!minibar}
					onOpenChange={(v) => { if (!v) setMinibar(null); }}
					stay={minibar.stay}
					roomLabel={minibar.room || undefined}
					guestName={minibar.guest}
					onPosted={reload}
				/>
			) : null}

			{linen && linen.room ? (
				<LinenSheet
					open={!!linen}
					onOpenChange={(v) => { if (!v) setLinen(null); }}
					room={linen.room}
					roomLabel={linen.room}
					stay={linen.stay}
					defaultPhase={linen.due_out ? "Departure" : "Mid-stay"}
					onPosted={reload}
				/>
			) : null}

			{ird ? (
				<IrdOrderSheet
					open={!!ird}
					onOpenChange={(v) => { if (!v) setIrd(null); }}
					stay={ird.stay}
					roomLabel={ird.room || undefined}
					guestName={ird.guest}
					onPosted={reload}
				/>
			) : null}

			{lateCheckout ? (
				<LateCheckoutSheet stay={lateCheckout} onClose={() => setLateCheckout(null)} onRequested={reload} />
			) : null}

			{earlyDep ? (
				<EarlyDepartureSheet stay={earlyDep} onClose={() => setEarlyDep(null)} onDeparted={reload} />
			) : null}

			{readiness ? (
				<CheckoutReadinessSheet stay={readiness} onClose={() => setReadiness(null)} />
			) : null}
		</WorkspacePage>
	);
}

const MOVE_REASONS: RoomMoveReason[] = ["Maintenance", "Guest Request", "Upgrade", "Downgrade", "Overbooking", "Other"];

function MoveRoomSheet({
	stay,
	onClose,
	onMoved,
}: {
	stay: FrontDeskInHouse;
	onClose: () => void;
	onMoved: () => void;
}) {
	const [rooms, setRooms] = useState<VacantRoom[] | null>(null);
	const [target, setTarget] = useState<string>("");
	const [reason, setReason] = useState<RoomMoveReason>("Guest Request");
	const [notes, setNotes] = useState("");
	const [ooo, setOoo] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		listVacantRoomsForMove(stay.stay)
			.then((r) => {
				setRooms(r.rooms);
				if (r.rooms[0]) setTarget(r.rooms[0].name);
			})
			.catch((e) => reportError(e, "Could not load available rooms"));
	}, [stay.stay]);

	// Maintenance reason → suggest marking source out-of-order (engineering signal).
	useEffect(() => {
		setOoo(reason === "Maintenance");
	}, [reason]);

	async function save() {
		if (!target) {
			toast.error("Pick a target room");
			return;
		}
		setBusy(true);
		try {
			const result = await moveGuestRoom({
				stay: stay.stay,
				to_room: target,
				reason,
				notes: notes || undefined,
				source_out_of_order: ooo,
			});
			toast.success(`${stay.guest} moved`, {
				description: `${result.from_room} → ${result.target_room_name ?? result.to_room}${result.maintenance_task ? " · maintenance task created" : ""}`,
			});
			onMoved();
			onClose();
		} catch (error) {
			reportError(error, "Move failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Move guest to another room</SheetTitle>
					<SheetDescription>
						{stay.guest} · currently in {stay.room ?? "—"}
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-4 py-4">
					<div>
						<Label htmlFor="move-target">Target room</Label>
						{rooms === null ? (
							<Skeleton className="mt-1 h-9 w-full" />
						) : rooms.length === 0 ? (
							<p className="mt-1 text-sm text-destructive">No vacant, sellable rooms available right now.</p>
						) : (
							<Select value={target} onValueChange={setTarget}>
								<SelectTrigger id="move-target" data-testid="move-target"><SelectValue /></SelectTrigger>
								<SelectContent>
									{rooms.map((r) => (
										<SelectItem key={r.name} value={r.name}>
											{r.room_name ?? r.room_number} · {r.room_number} · {r.housekeeping_status}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>

					<div>
						<Label htmlFor="move-reason">Reason</Label>
						<Select value={reason} onValueChange={(v) => setReason(v as RoomMoveReason)}>
							<SelectTrigger id="move-reason"><SelectValue /></SelectTrigger>
							<SelectContent>
								{MOVE_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
							</SelectContent>
						</Select>
					</div>

					<div>
						<Label htmlFor="move-notes">Notes</Label>
						<Input
							id="move-notes"
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							placeholder="e.g. Sudden power trip; AC unusable"
						/>
					</div>

					<label className="flex items-center gap-2 text-sm">
						<Checkbox checked={ooo} onCheckedChange={(v) => setOoo(Boolean(v))} data-testid="move-ooo" />
						Mark {stay.room ?? "source room"} <strong className="px-1">Out of Order</strong> &amp; create a maintenance task
					</label>
				</div>

				<SheetFooter>
					<Button onClick={save} disabled={busy || !target} data-testid="move-confirm">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />} Move guest
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function ExtendSheet({
	stay,
	onClose,
	onExtended,
}: {
	stay: FrontDeskInHouse;
	onClose: () => void;
	onExtended: () => void;
}) {
	const [date, setDate] = useState(stay.departure_date ?? "");
	const [busy, setBusy] = useState(false);

	async function save() {
		setBusy(true);
		try {
			const result = await extendStay(stay.stay, date);
			toast.success("Stay extended", {
				description: result.charge_added
					? `+${result.extra_nights} night(s) charged to the folio`
					: `New departure ${result.new_departure_date}`,
			});
			onExtended();
			onClose();
		} catch (error) {
			reportError(error, "Could not extend the stay");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 sm:max-w-sm" data-testid="extend-sheet">
				<SheetHeader>
					<SheetTitle>Extend stay</SheetTitle>
					<SheetDescription>{stay.guest} · room {stay.room ?? "—"}</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-3 px-4 py-4">
					<div className="text-sm text-muted-foreground">Current departure: {stay.departure_date ?? "—"}</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">New departure</Label>
						<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="extend-date" />
					</div>
				</div>
				<SheetFooter>
					<Button onClick={save} disabled={busy || !date} data-testid="extend-confirm">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Extend &amp; charge
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ── Late Checkout Sheet ────────────────────────────────────────────────

function LateCheckoutSheet({
	stay,
	onClose,
	onRequested,
}: {
	stay: FrontDeskInHouse;
	onClose: () => void;
	onRequested: () => void;
}) {
	const [time, setTime] = useState("14:00");
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);

	async function save() {
		setBusy(true);
		try {
			const result = await requestLateCheckout(stay.stay, time, reason || undefined);
			toast.success(result.reused ? "Late checkout already requested" : "Late checkout requested", {
				description: result.affects_incoming ? "Warning: conflicts with an incoming arrival" : `Requested until ${time}`,
			});
			onRequested();
			onClose();
		} catch (error) {
			reportError(error, "Could not request late checkout");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 sm:max-w-sm" data-testid="late-co-sheet">
				<SheetHeader>
					<SheetTitle>Request late checkout</SheetTitle>
					<SheetDescription>{stay.guest} · room {stay.room ?? "—"}</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-3 px-4 py-4">
					<div className="text-sm text-muted-foreground">Current departure: {stay.departure_date ?? "—"}</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">Requested checkout time</Label>
						<Input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="late-co-time" />
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">Reason</Label>
						<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Late flight" />
					</div>
				</div>
				<SheetFooter>
					<Button onClick={save} disabled={busy || !time} data-testid="late-co-confirm">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <Clock className="size-4" />} Request
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ── Early Departure Sheet ──────────────────────────────────────────────

function EarlyDepartureSheet({
	stay,
	onClose,
	onDeparted,
}: {
	stay: FrontDeskInHouse;
	onClose: () => void;
	onDeparted: () => void;
}) {
	const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);

	async function save() {
		setBusy(true);
		try {
			const result = await earlyDeparture(stay.stay, date, reason || undefined);
			toast.success("Early departure set", {
				description: `Shortened by ${result.nights_shortened} night(s) — housekeeping notified`,
			});
			onDeparted();
			onClose();
		} catch (error) {
			reportError(error, "Could not set early departure");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 sm:max-w-sm" data-testid="early-dep-sheet">
				<SheetHeader>
					<SheetTitle>Early departure</SheetTitle>
					<SheetDescription>{stay.guest} · room {stay.room ?? "—"}</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-3 px-4 py-4">
					<div className="text-sm text-muted-foreground">Current departure: {stay.departure_date ?? "—"}</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">New departure date</Label>
						<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="early-dep-date" />
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">Reason</Label>
						<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Change of plans" />
					</div>
				</div>
				<SheetFooter>
					<Button onClick={save} disabled={busy || !date} data-testid="early-dep-confirm">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarMinus className="size-4" />} Set early departure
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ── Checkout Readiness Sheet ───────────────────────────────────────────

function CheckoutReadinessSheet({
	stay,
	onClose,
}: {
	stay: FrontDeskInHouse;
	onClose: () => void;
}) {
	const [data, setData] = useState<CheckoutReadiness | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		getCheckoutReadiness(stay.stay)
			.then(setData)
			.catch((e) => reportError(e, "Could not load readiness"))
			.finally(() => setLoading(false));
	}, [stay.stay]);

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="readiness-sheet">
				<SheetHeader>
					<SheetTitle>Checkout readiness</SheetTitle>
					<SheetDescription>{stay.guest} · room {stay.room ?? "—"}</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-3 px-4 py-4">
					{loading ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Checking…
						</div>
					) : data ? (
						<>
							{data.can_checkout ? (
								<div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
									<CheckCircle2 className="size-4" /> Ready for checkout
								</div>
							) : (
								<div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
									<AlertTriangle className="size-4" /> Blocked — resolve before checkout
								</div>
							)}
							{data.blockers.length > 0 ? (
								<div className="flex flex-col gap-1">
									<span className="text-xs font-semibold uppercase text-muted-foreground">Blockers</span>
									{data.blockers.map((b, i) => (
										<div key={i} className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm dark:border-red-900 dark:bg-red-950">
											<AlertTriangle className="mt-0.5 size-3 shrink-0 text-red-600 dark:text-red-400" />
											{b.message}
										</div>
									))}
								</div>
							) : null}
							{data.warnings.length > 0 ? (
								<div className="flex flex-col gap-1">
									<span className="text-xs font-semibold uppercase text-muted-foreground">Warnings</span>
									{data.warnings.map((w, i) => (
										<div key={i} className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-2 text-sm dark:border-yellow-900 dark:bg-yellow-950">
											<AlertTriangle className="mt-0.5 size-3 shrink-0 text-yellow-600 dark:text-yellow-400" />
											{w.message}
										</div>
									))}
								</div>
							) : null}
						</>
					) : (
						<div className="text-sm text-muted-foreground">Could not load readiness data.</div>
					)}
				</div>
				<SheetFooter>
					<Button variant="outline" onClick={onClose}>Close</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ── Arrival readiness badges ───────────────────────────────────────────

const SETTLED_DEPOSIT = new Set(["Paid", "Not Required", "Waived"]);

function ArrivalReadinessBadges({ readiness }: { readiness: ArrivalReadiness }) {
	if (readiness.clear) {
		return (
			<div className="flex flex-wrap items-center gap-1">
				<Badge variant="secondary" className="gap-1">✓ Ready</Badge>
				<Badge variant={readiness.registration === "signed" ? "secondary" : "outline"} className="text-[11px]">
					Reg {readiness.registration === "signed" ? "✓" : "pending"}
				</Badge>
			</div>
		);
	}
	const depositOk = SETTLED_DEPOSIT.has(readiness.deposit);
	return (
		<div className="flex flex-wrap items-center gap-1">
			<Badge variant={readiness.kyc === "verified" ? "secondary" : "destructive"} className="text-[11px]">
				KYC {readiness.kyc === "verified" ? "✓" : readiness.kyc}
			</Badge>
			<Badge variant={depositOk ? "secondary" : "destructive"} className="text-[11px]">
				{readiness.deposit}
			</Badge>
			<Badge variant={readiness.registration === "signed" ? "secondary" : "outline"} className="text-[11px]">
				Reg {readiness.registration === "signed" ? "✓" : "pending"}
			</Badge>
		</div>
	);
}

// ── No-Show Section ────────────────────────────────────────────────────

function NoShowSection({ eligible, onMarked }: { eligible: NoShowEligible[]; onMarked: () => void }) {
	const [marking, setMarking] = useState<string | null>(null);
	const [reason, setReason] = useState("");

	async function handleMark(e: NoShowEligible) {
		if (!reason.trim()) {
			toast.error("Please enter a reason for the no-show");
			return;
		}
		setMarking(e.reservation);
		try {
			const result = await markNoShow(e.reservation, reason);
			toast.success(`${e.guest} marked as no-show`, {
				description: result.room_released ? `Room ${result.room_released} released` : undefined,
			});
			setReason("");
			onMarked();
		} catch (error) {
			reportError(error, "Could not mark no-show");
		} finally {
			setMarking(null);
		}
	}

	return (
		<section className="flex flex-col gap-2">
			<h2 className="flex items-center gap-2 text-sm font-semibold">
				<UserX className="size-4 text-destructive" /> No-show review
				<Badge variant="secondary">{eligible.length}</Badge>
			</h2>
			<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Guest</TableHead>
							<TableHead>Arrival</TableHead>
							<TableHead>Room type</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead className="text-right">Action</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{eligible.map((e) => (
							<TableRow key={e.reservation}>
								<TableCell className="font-medium">{e.guest}</TableCell>
								<TableCell className="text-sm">{e.arrival_date}</TableCell>
								<TableCell className="text-sm">{e.room_type ?? "—"}</TableCell>
								<TableCell>
									<Input
										value={reason}
										onChange={(ev) => setReason(ev.target.value)}
										placeholder="Reason…"
										className="h-8 w-40"
									/>
								</TableCell>
								<TableCell className="text-right">
									<Button
										size="sm"
										variant="destructive"
										disabled={marking === e.reservation}
										onClick={() => handleMark(e)}
									>
										{marking === e.reservation ? <Loader2 className="size-4 animate-spin" /> : <UserX className="size-4" />} No-show
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</section>
	);
}

// ── Late Checkout Pending Section ──────────────────────────────────────

function LateCheckoutSection({ requests, onActioned }: { requests: LateCheckoutRequest[]; onActioned: () => void }) {
	const [actioning, setActioning] = useState<string | null>(null);

	async function handleApprove(req: LateCheckoutRequest, approve: boolean, chargePolicy?: LateCheckoutChargePolicy) {
		setActioning(req.name);
		try {
			await approveLateCheckout(req.name, approve, chargePolicy);
			toast.success(approve ? "Late checkout approved" : "Late checkout rejected");
			onActioned();
		} catch (error) {
			reportError(error, "Could not process late checkout");
		} finally {
			setActioning(null);
		}
	}

	return (
		<section className="flex flex-col gap-2">
			<h2 className="flex items-center gap-2 text-sm font-semibold">
				<Clock className="size-4 text-amber-600" /> Pending late checkouts
				<Badge variant="secondary">{requests.length}</Badge>
			</h2>
			<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Guest</TableHead>
							<TableHead>Room</TableHead>
							<TableHead>Requested until</TableHead>
							<TableHead>Conflict</TableHead>
							<TableHead className="text-right">Action</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{requests.map((r) => (
							<TableRow key={r.name}>
								<TableCell className="font-medium">{r.guest_name}</TableCell>
								<TableCell className="text-sm">{r.room ?? "—"}</TableCell>
								<TableCell className="text-sm">{r.requested_checkout_time}</TableCell>
								<TableCell>
									{r.affects_incoming ? (
										<Badge variant="destructive">Incoming arrival</Badge>
									) : (
										<span className="text-sm text-muted-foreground">None</span>
									)}
								</TableCell>
								<TableCell className="text-right">
									<div className="flex justify-end gap-1">
										<Button
											size="sm"
											disabled={actioning === r.name}
											onClick={() => handleApprove(r, true, "No Charge")}
										>
											{actioning === r.name ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Approve
										</Button>
										<Button
											size="sm"
											variant="destructive"
											disabled={actioning === r.name}
											onClick={() => handleApprove(r, false)}
										>
											Reject
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</section>
	);
}

/** A count on a tab label. Muted by default; only genuine exceptions go red. */
function TabCount({ n, danger }: { n: number; danger?: boolean }) {
	return (
		<span
			className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
				danger ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground"
			}`}
		>
			{n}
		</span>
	);
}

interface StayActions {
	onExtend: (s: FrontDeskInHouse) => void;
	onEarlyDep: (s: FrontDeskInHouse) => void;
	onLateCheckout: (s: FrontDeskInHouse) => void;
	onMove: (s: FrontDeskInHouse) => void;
	onIrd: (s: FrontDeskInHouse) => void;
	onMinibar: (s: FrontDeskInHouse) => void;
	onLinen: (s: FrontDeskInHouse) => void;
	onReadiness: (s: FrontDeskInHouse) => void;
	onOpenFolio: (folio: string | null) => void;
	onCheckout: (s: FrontDeskInHouse) => void;
}

/**
 * One stay per row, with ONE primary action and everything else behind an
 * overflow menu.
 *
 * This previously rendered ten buttons of equal weight per row — Extend, Early
 * dep., Late C/O, Move, Order, Minibar, Linen, Open folio, Readiness, Check out
 * — so nothing read as the thing to do. The primary is now derived from state:
 * a guest who is due out needs checking out; anyone else, you are far more
 * likely to be opening their folio.
 */
function StayTable({
	stays,
	empty,
	actions,
	checkingOut,
}: {
	stays: FrontDeskInHouse[];
	empty: string;
	actions: StayActions;
	checkingOut: string | null;
}) {
	return (
		<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Guest</TableHead>
						<TableHead>Room</TableHead>
						<TableHead>Departure</TableHead>
						<TableHead>Folio</TableHead>
						<TableHead className="text-right">Action</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{stays.length === 0 ? (
						<TableRow>
							<TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">{empty}</TableCell>
						</TableRow>
					) : (
						stays.map((s) => (
							<TableRow key={s.stay} data-testid={`inhouse-${s.stay}`}>
								<TableCell className="font-medium">{s.guest}</TableCell>
								<TableCell className="text-sm">
									<div className="flex items-center gap-2">
										<RoomThumb image={s.room_image} label={s.room ?? "?"} size={32} />
										<span>{s.room ?? "—"}</span>
									</div>
								</TableCell>
								<TableCell className="text-sm">
									{s.departure_date ?? "—"}
									{s.due_out ? <Badge variant="destructive" className="ml-2">Due out</Badge> : null}
								</TableCell>
								<TableCell className="text-sm">{s.folio ?? "—"}</TableCell>
								<TableCell className="text-right">
									<div className="flex items-center justify-end gap-1">
										{s.due_out ? (
											<Button size="sm" disabled={checkingOut === s.stay} onClick={() => actions.onCheckout(s)} data-testid={`checkout-${s.stay}`}>
												{checkingOut === s.stay ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />} Check out
											</Button>
										) : (
											<Button size="sm" variant="outline" disabled={!s.folio} onClick={() => actions.onOpenFolio(s.folio ?? null)}>
												<ReceiptText className="size-4" /> Open folio
											</Button>
										)}
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button size="icon" variant="ghost" aria-label={`More actions for ${s.guest}`} data-testid={`more-${s.stay}`}>
													<MoreHorizontal className="size-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												{s.due_out ? (
													<DropdownMenuItem disabled={!s.folio} onSelect={() => actions.onOpenFolio(s.folio ?? null)}>
														<ReceiptText className="size-4" /> Open folio
													</DropdownMenuItem>
												) : (
													<DropdownMenuItem disabled={checkingOut === s.stay} onSelect={() => actions.onCheckout(s)} data-testid={`checkout-${s.stay}`}>
														<LogOut className="size-4" /> Check out
													</DropdownMenuItem>
												)}
												<DropdownMenuItem onSelect={() => actions.onExtend(s)} data-testid={`extend-${s.stay}`}>
													<CalendarPlus className="size-4" /> Extend stay
												</DropdownMenuItem>
												<DropdownMenuItem onSelect={() => actions.onEarlyDep(s)} data-testid={`early-dep-${s.stay}`}>
													<CalendarMinus className="size-4" /> Early departure
												</DropdownMenuItem>
												<DropdownMenuItem onSelect={() => actions.onLateCheckout(s)} data-testid={`late-co-${s.stay}`}>
													<Clock className="size-4" /> Late checkout
												</DropdownMenuItem>
												<DropdownMenuItem onSelect={() => actions.onMove(s)} data-testid={`move-${s.stay}`}>
													<ArrowRightLeft className="size-4" /> Move room
												</DropdownMenuItem>
												<DropdownMenuItem onSelect={() => actions.onIrd(s)} data-testid={`ird-${s.stay}`}>
													<UtensilsCrossed className="size-4" /> Room service
												</DropdownMenuItem>
												<DropdownMenuItem onSelect={() => actions.onMinibar(s)} data-testid={`minibar-${s.stay}`}>
													<Wine className="size-4" /> Minibar
												</DropdownMenuItem>
												<DropdownMenuItem disabled={!s.room} onSelect={() => actions.onLinen(s)} data-testid={`linen-${s.stay}`}>
													<Shirt className="size-4" /> Linen
												</DropdownMenuItem>
												<DropdownMenuItem onSelect={() => actions.onReadiness(s)} data-testid={`readiness-${s.stay}`}>
													<ClipboardCheck className="size-4" /> Readiness
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}
