/**
 * Split-bill sheet — spec 006 Workflow 5. Partition one unpaid order into N
 * portions (by item / amount / percentage), each settled independently:
 * pay direct (SI + Payment) or charge to an in-house room folio. The parent
 * order finalizes (and BOM stock is consumed once) when the last portion pays.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus, X } from "lucide-react";
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
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { FolioApiError } from "@/lib/folio-api";
import { formatINR } from "@/components/fnb/menu-visuals";
import { listInHouseStays, type InHouseStay, type RestaurantOrder } from "@/lib/restaurant-api";
import {
	cancelSplitPlan,
	createSplitPlan,
	settleSplit,
	type BillSplit,
	type PortionInput,
	type SplitType,
} from "@/lib/split-api";

const PAYMENT_MODES = ["Cash", "Card", "UPI", "Bank Transfer"];
const UI_SPLIT_TYPES: { value: SplitType; label: string; hint: string }[] = [
	{ value: "Item", label: "By item", hint: "Assign each dish to a guest" },
	{ value: "Amount", label: "By amount", hint: "Enter each portion's ₹ share" },
	{ value: "Percentage", label: "By %", hint: "Split by percentage" },
];

type PortionDraft = { label: string; mode: "Direct" | "Room"; stay: string | null };

function errMessage(error: unknown): string {
	return error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
}

export function SplitBillSheet({
	order,
	open,
	onOpenChange,
	onOrderSettled,
}: {
	order: RestaurantOrder;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onOrderSettled: () => void;
}) {
	const [phase, setPhase] = useState<"plan" | "settle">("plan");
	const [splitType, setSplitType] = useState<SplitType>("Item");
	const [count, setCount] = useState(2);
	const [portions, setPortions] = useState<PortionDraft[]>([]);
	const [rowAssign, setRowAssign] = useState<Record<string, number>>({});
	const [values, setValues] = useState<string[]>([]);
	const [splits, setSplits] = useState<BillSplit[]>([]);
	const [stays, setStays] = useState<InHouseStay[]>([]);
	const [busy, setBusy] = useState<string | null>(null);

	// Reset the planner each time the sheet opens.
	useEffect(() => {
		if (!open) return;
		setPhase("plan");
		setSplitType("Item");
		setCount(2);
		setSplits([]);
		listInHouseStays().then((r) => setStays(r.stays)).catch(() => setStays([]));
	}, [open]);

	// Keep portion drafts + per-portion value inputs sized to `count`.
	useEffect(() => {
		setPortions((prev) =>
			Array.from({ length: count }, (_, i) => prev[i] ?? { label: `Split ${i + 1}`, mode: "Direct", stay: null }),
		);
		setValues((prev) => Array.from({ length: count }, (_, i) => prev[i] ?? ""));
	}, [count]);

	// Default every order line to portion 0 so coverage starts complete.
	useEffect(() => {
		if (!open) return;
		const init: Record<string, number> = {};
		for (const row of order.items) init[row.name] = 0;
		setRowAssign(init);
	}, [open, order.items]);

	const grand = order.grand_total;

	const valueRemainder = useMemo(() => {
		const target = splitType === "Percentage" ? 100 : grand;
		const sum = values.reduce((s, v) => s + (Number(v) || 0), 0);
		return Math.round((target - sum) * 100) / 100;
	}, [values, splitType, grand]);

	function patchPortion(i: number, patch: Partial<PortionDraft>) {
		setPortions((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
	}

	function buildPayload(): PortionInput[] {
		return portions.map((p, i) => {
			const base = { label: p.label, settlement_mode: p.mode, stay: p.stay ?? undefined };
			if (splitType === "Item") {
				const items = order.items
					.filter((row) => rowAssign[row.name] === i)
					.map((row) => ({ order_item: row.name, qty: row.quantity }));
				return { ...base, items };
			}
			if (splitType === "Amount") return { ...base, amount: Number(values[i]) || 0 };
			return { ...base, percentage: Number(values[i]) || 0 };
		});
	}

	async function createPlan() {
		// Room portions need a stay chosen up front.
		if (portions.some((p) => p.mode === "Room" && !p.stay)) {
			toast.error("Pick an in-house guest for each room-billed split.");
			return;
		}
		setBusy("plan");
		try {
			const res = await createSplitPlan(order.name, splitType, buildPayload());
			setSplits(res.splits);
			setPhase("settle");
		} catch (error) {
			toast.error("Could not create split plan", { description: errMessage(error) });
		} finally {
			setBusy(null);
		}
	}

	async function settle(split: BillSplit, mode: string) {
		setBusy(split.name);
		try {
			const res =
				split.settlement_mode === "Room"
					? await settleSplit(split.name, undefined, split.room_stay ?? undefined)
					: await settleSplit(split.name, [{ mode_of_payment: mode, amount: split.grand_total }]);
			setSplits(res.splits);
			if (res.order_settled) {
				toast.success("All splits settled — order closed");
				onOrderSettled();
				onOpenChange(false);
			} else {
				toast.success(`${split.split_label ?? split.name} settled`);
			}
		} catch (error) {
			toast.error("Could not settle split", { description: errMessage(error) });
		} finally {
			setBusy(null);
		}
	}

	async function discardPlan() {
		setBusy("cancel");
		try {
			await cancelSplitPlan(order.name);
			setPhase("plan");
			setSplits([]);
		} catch (error) {
			toast.error("Could not discard plan", { description: errMessage(error) });
		} finally {
			setBusy(null);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="split-sheet">
				<SheetHeader>
					<SheetTitle>Split bill · {formatINR(grand)}</SheetTitle>
					<SheetDescription>{order.kot_number ?? order.name}</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-4 overflow-y-auto p-4">
					{phase === "plan" ? (
						<>
							{/* Split method */}
							<div className="flex flex-col gap-1.5">
								<Label>Split method</Label>
								<div className="grid grid-cols-3 gap-2">
									{UI_SPLIT_TYPES.map((t) => (
										<button
											key={t.value}
											type="button"
											onClick={() => setSplitType(t.value)}
											className={`rounded-md border px-2 py-2 text-xs ${
												splitType === t.value ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted"
											}`}
										>
											{t.label}
										</button>
									))}
								</div>
								<p className="text-[11px] text-muted-foreground">
									{UI_SPLIT_TYPES.find((t) => t.value === splitType)?.hint}
								</p>
							</div>

							{/* Portion count */}
							<div className="flex items-center justify-between">
								<Label>Number of guests</Label>
								<div className="flex items-center gap-2">
									<Button size="icon" variant="outline" disabled={count <= 2} onClick={() => setCount((c) => c - 1)}>
										<Minus className="size-4" />
									</Button>
									<span className="w-6 text-center font-mono tabular-nums">{count}</span>
									<Button size="icon" variant="outline" disabled={count >= 8} onClick={() => setCount((c) => c + 1)}>
										<Plus className="size-4" />
									</Button>
								</div>
							</div>

							{/* Per-portion settlement config */}
							<div className="flex flex-col gap-2">
								{portions.map((p, i) => (
									<div key={i} className="rounded-md border p-2.5">
										<div className="flex items-center gap-2">
											<Input
												value={p.label}
												onChange={(e) => patchPortion(i, { label: e.target.value })}
												className="h-8 flex-1 text-sm"
											/>
											<Select value={p.mode} onValueChange={(v) => patchPortion(i, { mode: v as "Direct" | "Room" })}>
												<SelectTrigger className="h-8 w-28 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="Direct">Pay direct</SelectItem>
													<SelectItem value="Room">To room</SelectItem>
												</SelectContent>
											</Select>
										</div>
										{p.mode === "Room" ? (
											<Select value={p.stay ?? ""} onValueChange={(v) => patchPortion(i, { stay: v })}>
												<SelectTrigger className="mt-2 h-8 text-xs">
													<SelectValue placeholder="Choose in-house guest…" />
												</SelectTrigger>
												<SelectContent>
													{stays.map((s) => (
														<SelectItem key={s.name} value={s.name}>
															{s.primary_guest_name ?? s.name} · {s.current_room ?? "—"}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										) : null}
										{splitType !== "Item" ? (
											<div className="mt-2 flex items-center gap-2">
												<Input
													type="number"
													value={values[i] ?? ""}
													onChange={(e) => setValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
													placeholder={splitType === "Percentage" ? "%" : "₹"}
													className="h-8 text-sm"
												/>
												<span className="text-xs text-muted-foreground">{splitType === "Percentage" ? "%" : "₹"}</span>
											</div>
										) : null}
									</div>
								))}
							</div>

							{/* Item allocation */}
							{splitType === "Item" ? (
								<div className="flex flex-col gap-1.5">
									<Label>Assign items</Label>
									{order.items.map((row) => (
										<div key={row.name} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
											<span className="flex-1 truncate text-sm">
												{row.quantity}× {row.item_name}
											</span>
											<Select
												value={String(rowAssign[row.name] ?? 0)}
												onValueChange={(v) => setRowAssign((prev) => ({ ...prev, [row.name]: Number(v) }))}
											>
												<SelectTrigger className="h-8 w-28 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{portions.map((p, idx) => (
														<SelectItem key={idx} value={String(idx)}>
															{p.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									))}
								</div>
							) : (
								<div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
									<span className="text-muted-foreground">
										Remaining to allocate
										<span className={Math.abs(valueRemainder) > 0.01 ? "ml-2 text-destructive" : "ml-2 text-[#198038] dark:text-[#42be65]"}>
											{splitType === "Percentage" ? `${valueRemainder}%` : formatINR(valueRemainder)}
										</span>
									</span>
								</div>
							)}

							<Button
								className="w-full"
								disabled={busy === "plan" || (splitType !== "Item" && Math.abs(valueRemainder) > 0.01)}
								onClick={createPlan}
								data-testid="split-create-plan"
							>
								{busy === "plan" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
								Create split plan
							</Button>
						</>
					) : (
						/* ---- settle phase ---- */
						<>
							<div className="flex flex-col gap-2">
								{splits.map((s) => (
									<SplitRow key={s.name} split={s} busy={busy === s.name} onSettle={settle} />
								))}
							</div>
							<Button variant="outline" className="w-full" disabled={busy === "cancel"} onClick={discardPlan}>
								{busy === "cancel" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
								Discard plan &amp; start over
							</Button>
							<p className="text-center text-[11px] text-muted-foreground">
								The order closes automatically once every split is settled.
							</p>
						</>
					)}
				</div>

				<button
					className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
					onClick={() => onOpenChange(false)}
					aria-label="Close"
				>
					<X className="size-4" />
				</button>
			</SheetContent>
		</Sheet>
	);
}

function SplitRow({
	split,
	busy,
	onSettle,
}: {
	split: BillSplit;
	busy: boolean;
	onSettle: (split: BillSplit, mode: string) => void;
}) {
	const [mode, setMode] = useState("Cash");
	const settled = split.split_status === "Settled";

	return (
		<div className="rounded-md border p-2.5">
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium">{split.split_label ?? split.name}</span>
				<span className="font-mono text-sm tabular-nums">{formatINR(split.grand_total)}</span>
			</div>
			<div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
				<Badge variant={settled ? "secondary" : "outline"}>{split.split_status}</Badge>
				<span>{split.settlement_mode === "Room" ? "Charge to room" : "Pay direct"}</span>
			</div>
			{!settled ? (
				<div className="mt-2 flex items-center gap-2">
					{split.settlement_mode === "Direct" ? (
						<Select value={mode} onValueChange={setMode}>
							<SelectTrigger className="h-8 w-32 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{PAYMENT_MODES.map((m) => (
									<SelectItem key={m} value={m}>
										{m}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : null}
					<Button
						size="sm"
						className="flex-1"
						disabled={busy}
						onClick={() => onSettle(split, mode)}
						data-testid={`split-settle-${split.name}`}
					>
						{busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
						{split.settlement_mode === "Room" ? "Charge to room" : "Settle"}
					</Button>
				</div>
			) : null}
		</div>
	);
}
