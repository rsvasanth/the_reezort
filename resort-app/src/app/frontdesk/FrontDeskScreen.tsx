/**
 * Front Desk — arrivals (check in) + in-house (open folio / check out).
 * Drives the existing check_in / check_out PMS endpoints. Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, CalendarPlus, Loader2, LogIn, LogOut, ReceiptText } from "lucide-react";
import { toast } from "sonner";

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
import { OccupancyTimeline } from "@/components/occupancy-timeline";
import { WorkspacePage, KpiStrip } from "@/components/workspace/workspace";
import {
	FolioApiError,
	checkOut,
	extendStay,
	getFrontDeskBoard,
	listVacantRoomsForMove,
	moveGuestRoom,
	type FrontDeskBoard,
	type FrontDeskInHouse,
	type RoomMoveReason,
	type VacantRoom,
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
	const [checkingOut, setCheckingOut] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setBoard(await getFrontDeskBoard());
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
				<>
					<KpiStrip
						items={[
							{ label: "Arrivals", value: board.counts.arrivals },
							{ label: "In-house", value: board.counts.in_house },
							{ label: "Due out", value: board.counts.due_out, accent: board.counts.due_out > 0 ? "danger" : undefined },
						]}
					/>

					<OccupancyTimeline />

					{/* Arrivals */}
					<section className="flex flex-col gap-2">
						<h2 className="text-sm font-semibold">Arrivals</h2>
						<div className="rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Guest</TableHead>
										<TableHead>Room type</TableHead>
										<TableHead>Arrival</TableHead>
										<TableHead>Nights</TableHead>
										<TableHead className="text-right">Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{board.arrivals.length === 0 ? (
										<TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No arrivals pending.</TableCell></TableRow>
									) : (
										board.arrivals.map((a) => (
											<TableRow key={a.reservation} data-testid={`arrival-${a.reservation}`}>
												<TableCell className="font-medium">{a.guest}
													{a.due_today ? <Badge variant="secondary" className="ml-2">Today</Badge> : null}
												</TableCell>
												<TableCell className="text-sm">{a.room_type ?? "—"}</TableCell>
												<TableCell className="text-sm">{a.arrival_date ?? "—"}</TableCell>
												<TableCell className="text-sm">{a.nights ?? "—"}</TableCell>
												<TableCell className="text-right">
													<Button
														size="sm"
														onClick={() => { window.location.hash = `#/check-in/${encodeURIComponent(a.reservation)}`; }}
														data-testid={`checkin-${a.reservation}`}
													>
														<LogIn className="size-4" />
														Check in
													</Button>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
					</section>

					{/* In-house */}
					<section className="flex flex-col gap-2">
						<h2 className="text-sm font-semibold">In-house</h2>
						<div className="rounded-lg border">
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
									{board.in_house.length === 0 ? (
										<TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No in-house guests.</TableCell></TableRow>
									) : (
										board.in_house.map((s) => (
											<TableRow key={s.stay} data-testid={`inhouse-${s.stay}`}>
												<TableCell className="font-medium">{s.guest}</TableCell>
												<TableCell className="text-sm">{s.room ?? "—"}</TableCell>
												<TableCell className="text-sm">
													{s.departure_date ?? "—"}
													{s.due_out ? <Badge variant="destructive" className="ml-2">Due out</Badge> : null}
												</TableCell>
												<TableCell className="text-sm">{s.folio ?? "—"}</TableCell>
												<TableCell className="text-right">
													<div className="flex justify-end gap-1">
														<Button size="sm" variant="ghost" onClick={() => setExtending(s)} data-testid={`extend-${s.stay}`}>
															<CalendarPlus className="size-4" /> Extend
														</Button>
														<Button size="sm" variant="ghost" onClick={() => setMoving(s)} data-testid={`move-${s.stay}`}>
															<ArrowRightLeft className="size-4" /> Move
														</Button>
														<Button size="sm" variant="outline" disabled={!s.folio} onClick={() => openFolio(s.folio)}>
															<ReceiptText className="size-4" /> Open folio
														</Button>
														<Button
															size="sm"
															variant={s.due_out ? "default" : "ghost"}
															disabled={checkingOut === s.stay}
															onClick={() => handleCheckout(s)}
															data-testid={`checkout-${s.stay}`}
														>
															{checkingOut === s.stay ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />} Check out
														</Button>
													</div>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
					</section>
				</>
			) : (
				<Card><CardContent className="py-8 text-sm text-muted-foreground">Could not load the front desk.</CardContent></Card>
			)}

			{extending ? (
				<ExtendSheet stay={extending} onClose={() => setExtending(null)} onExtended={reload} />
			) : null}

			{moving ? (
				<MoveRoomSheet stay={moving} onClose={() => setMoving(null)} onMoved={reload} />
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
