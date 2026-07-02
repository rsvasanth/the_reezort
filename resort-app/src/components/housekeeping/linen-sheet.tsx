/**
 * LinenSheet — checkout / mid-stay linen count.
 * (spec 005 / ui-ux-linen-checkout-restock)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Loader2, Shirt } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { staggerContainer, staggerItem } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import {
	getRoomPar,
	listRecentLinenCounts,
	postLinenCount,
	type LinenMovementRow,
	type RoomPar,
} from "@/lib/linen-api";

type CountRow = { found: string; damaged: string; missing: string; notes: string };

function fmtDT(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", {
		day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
	}).format(d);
}

export function LinenSheet({
	open,
	onOpenChange,
	room,
	roomLabel,
	stay,
	defaultPhase = "Departure",
	onPosted,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	room: string;
	roomLabel?: string;
	stay?: string | null;
	defaultPhase?: "Departure" | "Mid-stay" | "Par audit";
	onPosted?: () => void;
}) {
	const [par, setPar] = useState<RoomPar | null>(null);
	const [buffer, setBuffer] = useState<Record<string, CountRow>>({});
	const [phase, setPhase] = useState(defaultPhase);
	const [notes, setNotes] = useState("");
	const [recent, setRecent] = useState<LinenMovementRow[]>([]);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const [p, r] = await Promise.all([
				getRoomPar(room),
				listRecentLinenCounts(room, 30, 5).catch(() => ({ movements: [] as LinenMovementRow[] })),
			]);
			setPar(p);
			setRecent(r.movements);
			// Prime buffer with empty rows.
			const seed: Record<string, CountRow> = {};
			for (const i of p.items) {
				seed[i.name] = { found: "", damaged: "", missing: "", notes: "" };
			}
			setBuffer(seed);
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not load linen catalog", { description: detail });
		}
	}, [room]);

	useEffect(() => {
		if (open) {
			setPhase(defaultPhase);
			setNotes("");
			load();
		}
	}, [open, defaultPhase, load]);

	function bump(itemName: string, field: keyof CountRow, value: string) {
		setBuffer((prev) => ({
			...prev,
			[itemName]: { ...(prev[itemName] ?? { found: "", damaged: "", missing: "", notes: "" }), [field]: value },
		}));
	}

	const summary = useMemo(() => {
		if (!par) return { short: 0, damaged: 0, missing: 0, filled: 0 };
		let short = 0;
		let damaged = 0;
		let missing = 0;
		let filled = 0;
		for (const i of par.items) {
			const row = buffer[i.name];
			if (!row) continue;
			const found = Number(row.found || 0);
			const d = Number(row.damaged || 0);
			const m = Number(row.missing || 0);
			if (row.found !== "" || d > 0 || m > 0) filled += 1;
			if (i.par && found < i.par) short += i.par - found;
			damaged += d;
			missing += m;
		}
		return { short, damaged, missing, filled };
	}, [par, buffer]);

	async function post() {
		if (!par) return;
		const counts = par.items
			.map((i) => {
				const row = buffer[i.name] ?? { found: "", damaged: "", missing: "", notes: "" };
				return {
					linen_item: i.name,
					par: i.par,
					found: Number(row.found || 0),
					damaged: Number(row.damaged || 0),
					missing: Number(row.missing || 0),
					notes: row.notes || undefined,
				};
			})
			.filter((c) => c.found > 0 || c.damaged > 0 || c.missing > 0);

		if (counts.length === 0) {
			toast.error("Enter at least one count");
			return;
		}

		setBusy(true);
		try {
			const res = await postLinenCount({
				room,
				counts,
				phase,
				stay: stay ?? null,
				notes: notes || undefined,
			});
			const bits = [
				res.short_count > 0 ? `${res.short_count} below par` : "no shortages",
				res.damaged_count > 0 ? `${res.damaged_count} damaged` : null,
				res.missing_count > 0 ? `${res.missing_count} missing` : null,
			].filter(Boolean).join(" · ");
			toast.success(`Linen count posted · ${res.linen_movement}`, { description: bits });
			if (res.restock_task) {
				toast.info(`Restock task created · ${res.restock_task}`);
			}
			onOpenChange(false);
			onPosted?.();
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			if (typeof detail === "string" && detail.toLowerCase().includes("approval")) {
				toast.warning("Approval requested — a manager will review", { description: detail });
			} else {
				toast.error("Could not post linen count", { description: detail });
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl" data-testid="linen-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<Shirt className="size-4" /> Linen · {roomLabel ?? room}
					</SheetTitle>
					<SheetDescription>
						Count linens vs par. Below-par rows auto-create a Restock task.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
					<div className="grid grid-cols-2 gap-3">
						<div>
							<Label className="text-xs">Phase</Label>
							<Select value={phase} onValueChange={(v) => setPhase(v as typeof phase)}>
								<SelectTrigger data-testid="linen-phase">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="Departure">Departure</SelectItem>
									<SelectItem value="Mid-stay">Mid-stay</SelectItem>
									<SelectItem value="Par audit">Par audit</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label className="text-xs">Overall notes</Label>
							<Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Room condition, laundry note…" data-testid="linen-notes" />
						</div>
					</div>

					{par === null ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading catalog…
						</div>
					) : par.items.length === 0 ? (
						<div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
							No linen catalog yet — set one up in Property management.
						</div>
					) : (
						<motion.div
							className="rounded-md border"
							variants={staggerContainer}
							initial="hidden"
							animate="show"
						>
							<div className="grid grid-cols-[minmax(0,1.6fr)_60px_70px_70px_70px] gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
								<span>Item</span>
								<span className="text-right">Par</span>
								<span className="text-right">Found</span>
								<span className="text-right">Damaged</span>
								<span className="text-right">Missing</span>
							</div>
							{par.items.map((i) => {
								const row = buffer[i.name] ?? { found: "", damaged: "", missing: "", notes: "" };
								const found = Number(row.found || 0);
								const belowPar = i.par > 0 && row.found !== "" && found < i.par;
								return (
									<motion.div
										key={i.name}
										variants={staggerItem}
										className={`grid grid-cols-[minmax(0,1.6fr)_60px_70px_70px_70px] gap-2 border-b px-3 py-1.5 text-sm last:border-b-0 ${belowPar ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
										data-testid={`linen-row-${i.item_code_short}`}
									>
										<span className="truncate">
											{i.item_name}
											<span className="ml-1 text-[10px] text-muted-foreground">{i.category}</span>
										</span>
										<span className="text-right text-sm tabular-nums text-muted-foreground">{i.par}</span>
										<Input
											type="number"
											inputMode="numeric"
											min={0}
											value={row.found}
											onChange={(e) => bump(i.name, "found", e.target.value)}
											className="h-7 px-2 text-right"
											data-testid={`found-${i.item_code_short}`}
										/>
										<Input
											type="number"
											inputMode="numeric"
											min={0}
											value={row.damaged}
											onChange={(e) => bump(i.name, "damaged", e.target.value)}
											className="h-7 px-2 text-right"
											data-testid={`damaged-${i.item_code_short}`}
										/>
										<Input
											type="number"
											inputMode="numeric"
											min={0}
											value={row.missing}
											onChange={(e) => bump(i.name, "missing", e.target.value)}
											className="h-7 px-2 text-right"
											data-testid={`missing-${i.item_code_short}`}
										/>
									</motion.div>
								);
							})}
						</motion.div>
					)}

					{summary.short > 0 || summary.damaged > 0 || summary.missing > 0 ? (
						<div className="flex items-center gap-1 text-xs text-amber-700" data-testid="linen-summary">
							<AlertTriangle className="size-3" />
							{summary.short} below par · {summary.damaged} damaged · {summary.missing} missing
						</div>
					) : null}

					{recent.length > 0 ? (
						<div>
							<div className="mb-1 text-xs text-muted-foreground">Last {recent.length} counts</div>
							<div className="flex flex-col divide-y rounded-md border">
								{recent.map((m) => (
									<div key={m.name} className="flex items-center justify-between p-2 text-xs">
										<div className="min-w-0">
											<div className="truncate font-medium">{m.name} · {m.phase}</div>
											<div className="text-muted-foreground">{fmtDT(m.counted_at)}</div>
										</div>
										<div className="text-right text-muted-foreground">
											{m.short_count === 0 && m.damaged_count === 0 ? "Complete" : `${m.short_count} short · ${m.damaged_count} damaged`}
										</div>
									</div>
								))}
							</div>
						</div>
					) : null}
				</div>

				<SheetFooter className="border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
					<Badge variant="secondary">
						{summary.filled} filled
					</Badge>
					<div className="flex gap-2">
						<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
						<Button onClick={post} disabled={busy || summary.filled === 0} data-testid="linen-post">
							{busy ? <Loader2 className="size-4 animate-spin" /> : null}
							Post count &amp; release
						</Button>
					</div>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
