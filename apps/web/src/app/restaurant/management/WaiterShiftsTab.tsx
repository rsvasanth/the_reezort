/**
 * WaiterShiftsTab — the waiter assignment board for a day: which waiter is on
 * which table, their shift window, and live order count. Managers can assign a
 * waiter to a table (a side sheet) or end an active shift early.
 *
 * The waiter picker is a free-text email with a datalist seeded from recent
 * sellers (sales_by_waiter) — role-safe for the Restaurant role, which can't
 * read the full staff directory.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus, RefreshCw, UserX } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { FolioApiError } from "@/lib/folio-api";
import { listTables, type RestaurantTable } from "@/lib/restaurant-api";
import type { FnbOutlet } from "@/lib/fnb-api";
import {
	assignWaiter,
	listWaiterAssignments,
	mockAssignments,
	rangeEndingYesterday,
	salesByWaiter,
	unassignWaiter,
	type WaiterAssignmentRow,
	type WaiterAssignments,
	type WaiterAssignmentStatus,
	type WaiterSales,
} from "@/lib/restaurant-management-api";

type LoadState = "loading" | "live" | "mock" | "error" | "denied";

const STATUS_TONE: Record<WaiterAssignmentStatus, "secondary" | "outline" | "destructive"> = {
	Active: "secondary",
	Completed: "outline",
	Cancelled: "destructive",
};

function todayStr(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "10:00" from a "YYYY-MM-DD HH:MM:SS" (or ISO) stamp. */
function fmtTime(stamp: string): string {
	const t = stamp.includes("T") ? stamp.split("T")[1] : stamp.split(" ")[1];
	return t ? t.slice(0, 5) : "—";
}

export default function WaiterShiftsTab({ outlet, outlets }: { outlet: string; outlets: FnbOutlet[] }) {
	const [date, setDate] = useState(todayStr());
	const [data, setData] = useState<WaiterAssignments | null>(null);
	const [state, setState] = useState<LoadState>("loading");
	const [busy, setBusy] = useState<string | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);

	const load = useCallback(() => {
		setState("loading");
		// The board shows the day's Active shifts — the endpoint's default. Ending
		// a shift flips it to Cancelled, which drops it off on the next reload.
		listWaiterAssignments({ outlet: outlet || undefined, on_date: date })
			.then((res) => {
				setData(res);
				setState("live");
			})
			.catch((error: unknown) => {
				if (error instanceof FolioApiError && error.status === 403) {
					setState("denied");
					return;
				}
				if (error instanceof FolioApiError && error.status >= 400 && error.status < 500) {
					setState("error");
					return;
				}
				setData(mockAssignments(outlet || null, date));
				setState("mock");
			});
	}, [outlet, date]);

	useEffect(() => {
		load();
	}, [load]);

	async function endShift(row: WaiterAssignmentRow) {
		if (busy) return;
		if (!window.confirm(`End ${row.waiter_name ?? row.waiter_user}'s shift on ${row.table_code ?? row.table}?`)) return;
		setBusy(row.assignment);
		try {
			await unassignWaiter(row.assignment);
			toast.success("Shift ended");
			load();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not end shift", { description: msg });
		} finally {
			setBusy(null);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex items-end gap-3">
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs text-muted-foreground">Date</Label>
						<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" data-testid="shifts-date" />
					</div>
					{state === "mock" ? <Badge variant="outline" className="mb-2">Mock</Badge> : null}
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" aria-label="Refresh" onClick={load}>
						<RefreshCw className="size-4" />
					</Button>
					<Button
						className="bg-brass text-brass-foreground hover:bg-brass/90"
						onClick={() => setSheetOpen(true)}
						data-testid="assign-waiter-open"
					>
						<Plus className="mr-1.5 size-4" /> Assign waiter
					</Button>
				</div>
			</div>

			{state === "loading" ? (
				<div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading shifts…
				</div>
			) : state === "denied" ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						You do not have permission to view shifts. Ask a manager.
					</CardContent>
				</Card>
			) : state === "error" || !data ? (
				<div className="flex flex-col items-center gap-3 py-16 text-center">
					<p className="text-sm text-muted-foreground">Could not load waiter shifts.</p>
					<Button variant="outline" onClick={load}>
						<RefreshCw className="mr-1.5 size-4" /> Retry
					</Button>
				</div>
			) : data.assignments.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
					<CalendarClock className="size-7 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">No waiter shifts on this day. Assign one above.</p>
				</div>
			) : (
				<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
					<Table data-testid="shifts-board">
						<TableHeader>
							<TableRow>
								<TableHead>Table</TableHead>
								<TableHead>Waiter</TableHead>
								<TableHead>Shift</TableHead>
								<TableHead className="text-right">Orders</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.assignments.map((r) => (
								<TableRow key={r.assignment} data-testid={`shift-${r.assignment}`}>
									<TableCell>
										<div className="font-medium">{r.table_code ?? r.table}</div>
										<div className="text-[11px] text-muted-foreground">
											{r.table_name ?? "—"}
											{r.table_zone ? ` · ${r.table_zone}` : ""}
										</div>
									</TableCell>
									<TableCell>
										<div className="font-medium">{r.waiter_name ?? r.waiter_user}</div>
										<div className="text-[11px] text-muted-foreground">{r.waiter_user}</div>
									</TableCell>
									<TableCell className="tabular-nums">
										{fmtTime(r.shift_start)} – {fmtTime(r.shift_end)}
									</TableCell>
									<TableCell className="text-right tabular-nums">{r.orders_today}</TableCell>
									<TableCell>
										<Badge variant={STATUS_TONE[r.status]}>{r.status}</Badge>
									</TableCell>
									<TableCell className="text-right">
										{r.status === "Active" ? (
											<Button
												variant="ghost"
												size="sm"
												disabled={busy === r.assignment}
												onClick={() => endShift(r)}
												data-testid={`end-shift-${r.assignment}`}
											>
												{busy === r.assignment ? <Loader2 className="size-4 animate-spin" /> : <UserX className="mr-1.5 size-4" />}
												End
											</Button>
										) : null}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<AssignSheet
				open={sheetOpen}
				onOpenChange={setSheetOpen}
				outlets={outlets}
				defaultOutlet={outlet || outlets[0]?.name || ""}
				date={date}
				onAssigned={() => {
					setSheetOpen(false);
					load();
				}}
			/>
		</div>
	);
}

function AssignSheet({
	open,
	onOpenChange,
	outlets,
	defaultOutlet,
	date,
	onAssigned,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	outlets: FnbOutlet[];
	defaultOutlet: string;
	date: string;
	onAssigned: () => void;
}) {
	const [sheetOutlet, setSheetOutlet] = useState(defaultOutlet);
	const [tables, setTables] = useState<RestaurantTable[]>([]);
	const [table, setTable] = useState("");
	const [waiter, setWaiter] = useState("");
	const [knownWaiters, setKnownWaiters] = useState<WaiterSales[]>([]);
	const [shiftStart, setShiftStart] = useState(`${date}T10:00`);
	const [shiftEnd, setShiftEnd] = useState(`${date}T18:00`);
	const [notes, setNotes] = useState("");
	const [saving, setSaving] = useState(false);

	// Reset the form to the current context each time the sheet opens.
	useEffect(() => {
		if (!open) return;
		setSheetOutlet(defaultOutlet);
		setTable("");
		setWaiter("");
		setNotes("");
		setShiftStart(`${date}T10:00`);
		setShiftEnd(`${date}T18:00`);
	}, [open, defaultOutlet, date]);

	// Load tables + recent-seller datalist for the chosen outlet. A table from a
	// previously-selected outlet must not linger, so clear the pick on change.
	useEffect(() => {
		if (!open || !sheetOutlet) return;
		setTable("");
		listTables(sheetOutlet)
			.then((res) => setTables(res.tables))
			.catch(() => setTables([]));
		const range = rangeEndingYesterday(30);
		salesByWaiter({ ...range, outlet: sheetOutlet })
			.then((res) => setKnownWaiters(res.waiters))
			.catch(() => setKnownWaiters([]));
	}, [open, sheetOutlet]);

	async function submit() {
		if (saving) return;
		if (!table) {
			toast.error("Pick a table");
			return;
		}
		if (!waiter.trim()) {
			toast.error("Enter a waiter email");
			return;
		}
		if (shiftEnd <= shiftStart) {
			toast.error("Shift end must be after the start");
			return;
		}
		setSaving(true);
		try {
			await assignWaiter({
				restaurant_table: table,
				waiter_user: waiter.trim(),
				shift_start: `${shiftStart.replace("T", " ")}:00`,
				shift_end: `${shiftEnd.replace("T", " ")}:00`,
				outlet: sheetOutlet || undefined,
				notes: notes.trim() || undefined,
			});
			toast.success("Waiter assigned");
			onAssigned();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not assign waiter", { description: msg });
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full flex-col gap-4 sm:max-w-md" data-testid="assign-sheet">
				<SheetHeader>
					<SheetTitle>Assign waiter</SheetTitle>
					<SheetDescription>Put a waiter on a table for a shift window.</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto">
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Outlet</Label>
						<Select value={sheetOutlet} onValueChange={setSheetOutlet}>
							<SelectTrigger data-testid="assign-outlet">
								<SelectValue placeholder="Choose outlet" />
							</SelectTrigger>
							<SelectContent>
								{outlets.map((o) => (
									<SelectItem key={o.name} value={o.name}>
										{o.outlet_name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Table</Label>
						<Select value={table} onValueChange={setTable}>
							<SelectTrigger data-testid="assign-table">
								<SelectValue placeholder={tables.length ? "Choose table" : "No tables in outlet"} />
							</SelectTrigger>
							<SelectContent>
								{tables.map((t) => (
									<SelectItem key={t.name} value={t.name}>
										{t.table_code} · {t.table_name} ({t.zone})
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label className="text-xs" htmlFor="assign-waiter-input">Waiter email</Label>
						<Input
							id="assign-waiter-input"
							list="known-waiters"
							placeholder="e.g. ravi@thereezort.com"
							value={waiter}
							onChange={(e) => setWaiter(e.target.value)}
							data-testid="assign-waiter-input"
						/>
						<datalist id="known-waiters">
							{knownWaiters.map((w) => (
								<option key={w.user} value={w.user}>
									{w.waiter_name ?? w.user}
								</option>
							))}
						</datalist>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs">Shift start</Label>
							<Input type="datetime-local" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} data-testid="assign-start" />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs">Shift end</Label>
							<Input type="datetime-local" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} data-testid="assign-end" />
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Notes (optional)</Label>
						<Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Covering a break, section, etc." />
					</div>
				</div>

				<SheetFooter>
					<Button onClick={submit} disabled={saving} className="w-full" data-testid="assign-submit">
						{saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plus className="mr-1.5 size-4" />}
						Assign
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
