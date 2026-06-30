/**
 * Front Desk — arrivals (check in) + in-house (open folio / check out).
 * Drives the existing check_in / check_out PMS endpoints. Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Loader2, LogIn, LogOut, ReceiptText } from "lucide-react";
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
import { WorkspacePage, KpiStrip } from "@/components/workspace/workspace";
import { FolioApiError, checkOut, extendStay, getFrontDeskBoard, type FrontDeskBoard, type FrontDeskInHouse } from "@/lib/pms-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.message : String(error);
	toast.error(fallback, { description: detail });
}

export default function FrontDeskScreen() {
	const [board, setBoard] = useState<FrontDeskBoard | null>(null);
	const [loading, setLoading] = useState(true);
	const [extending, setExtending] = useState<FrontDeskInHouse | null>(null);
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
		</WorkspacePage>
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
