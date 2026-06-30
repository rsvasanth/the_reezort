/**
 * Front Desk — arrivals (check in) + in-house (open folio / check out).
 * Drives the existing check_in / check_out PMS endpoints. Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, LogIn, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { FolioApiError, checkIn, getFrontDeskBoard, type FrontDeskBoard } from "@/lib/pms-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.message : String(error);
	toast.error(fallback, { description: detail });
}

export default function FrontDeskScreen() {
	const [board, setBoard] = useState<FrontDeskBoard | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);

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

	async function handleCheckIn(reservation: string, guest: string) {
		setBusy(reservation);
		try {
			const result = await checkIn(reservation);
			toast.success(`${guest} checked in`, {
				description: result.current_room ? `Room ${result.current_room} · folio ${result.folio}` : `Folio ${result.folio}`,
			});
			await reload();
		} catch (error) {
			reportError(error, "Check-in failed");
		} finally {
			setBusy(null);
		}
	}

	function openFolio(folio: string | null) {
		if (folio) window.location.hash = `#/folio/${folio}`;
	}

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6" data-testid="frontdesk-screen">
			<header>
				<Badge variant="outline" className="mb-2">Front desk</Badge>
				<h1 className="text-3xl font-light text-foreground md:text-4xl">Front desk</h1>
				<p className="mt-1 text-sm text-muted-foreground">Arrivals, in-house guests, and departures.</p>
			</header>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : board ? (
				<>
					<div className="flex flex-wrap gap-2">
						<Badge variant="secondary">{board.counts.arrivals} arrivals</Badge>
						<Badge variant="secondary">{board.counts.in_house} in-house</Badge>
						{board.counts.due_out > 0 ? <Badge variant="destructive">{board.counts.due_out} due out</Badge> : null}
					</div>

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
														disabled={busy === a.reservation}
														onClick={() => handleCheckIn(a.reservation, a.guest)}
														data-testid={`checkin-${a.reservation}`}
													>
														{busy === a.reservation ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
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
													<Button size="sm" variant="outline" disabled={!s.folio} onClick={() => openFolio(s.folio)}>
														<ReceiptText className="size-4" /> Open folio
													</Button>
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
		</main>
	);
}
