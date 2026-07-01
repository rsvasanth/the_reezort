/**
 * MinibarSheet — post minibar consumption to a stay's folio.
 * (spec 004 / ui-ux-minibar-posting)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Loader2, Minus, Plus, Wine } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { staggerContainer, staggerItem } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import {
	listMinibarItems,
	listRecentMinibarPostings,
	postMinibarConsumption,
	type MinibarItem,
	type MinibarPostingRow,
} from "@/lib/minibar-api";

function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function nowLocalIso(): string {
	const d = new Date();
	const off = d.getTimezoneOffset();
	const local = new Date(d.getTime() - off * 60_000);
	return local.toISOString().slice(0, 16);
}

function fmtDT(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", {
		day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
	}).format(d);
}

type Basket = Record<string, number>;

export function MinibarSheet({
	open,
	onOpenChange,
	stay,
	roomLabel,
	guestName,
	resortProperty,
	onPosted,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	stay: string;
	roomLabel?: string;
	guestName?: string | null;
	resortProperty?: string;
	onPosted?: () => void;
}) {
	const [items, setItems] = useState<MinibarItem[] | null>(null);
	const [category, setCategory] = useState<string>("Beverages");
	const [basket, setBasket] = useState<Basket>({});
	const [consumedAt, setConsumedAt] = useState<string>(nowLocalIso());
	const [notes, setNotes] = useState<string>("");
	const [busy, setBusy] = useState(false);
	const [recent, setRecent] = useState<MinibarPostingRow[]>([]);

	const load = useCallback(async () => {
		try {
			const [cat, rec] = await Promise.all([
				listMinibarItems(resortProperty),
				listRecentMinibarPostings(stay, 5).catch(() => ({ postings: [] as MinibarPostingRow[] })),
			]);
			setItems(cat.items);
			setRecent(rec.postings);
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not load minibar catalog", { description: detail });
		}
	}, [resortProperty, stay]);

	useEffect(() => {
		if (open) {
			setBasket({});
			setNotes("");
			setConsumedAt(nowLocalIso());
			load();
		}
	}, [open, load]);

	const categories = useMemo(() => {
		if (!items) return [] as string[];
		return Array.from(new Set(items.map((i) => i.category))).sort();
	}, [items]);

	const filtered = useMemo(() => {
		return (items ?? []).filter((i) => i.category === category);
	}, [items, category]);

	const subtotal = useMemo(() => {
		if (!items) return 0;
		return items.reduce((sum, i) => sum + (basket[i.name] || 0) * i.price, 0);
	}, [items, basket]);

	const totalItems = useMemo(
		() => Object.values(basket).reduce((s, q) => s + q, 0),
		[basket],
	);

	const hoursBack = useMemo(() => {
		const t = new Date(consumedAt).getTime();
		if (Number.isNaN(t)) return 0;
		return Math.max(0, (Date.now() - t) / 36e5);
	}, [consumedAt]);

	function bump(name: string, delta: number) {
		setBasket((prev) => {
			const next = { ...prev };
			const q = Math.max(0, (next[name] ?? 0) + delta);
			if (q === 0) delete next[name];
			else next[name] = q;
			return next;
		});
	}

	async function post() {
		if (totalItems === 0) {
			toast.error("Add at least one item");
			return;
		}
		setBusy(true);
		try {
			const payload = {
				stay,
				items: Object.entries(basket).map(([minibar_item, quantity]) => ({ minibar_item, quantity })),
				consumed_at: consumedAt.replace("T", " "),
				notes: notes || undefined,
			};
			const res = await postMinibarConsumption(payload);
			toast.success(`Posted ${formatINR(res.total_amount)} to folio`, {
				description: res.reused ? "Already posted — reused existing line." : res.folio_line,
			});
			onOpenChange(false);
			onPosted?.();
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			// Approval-required errors surface as ValidationError with "Approval required" in message.
			if (typeof detail === "string" && detail.toLowerCase().includes("approval")) {
				toast.warning("Approval requested — a manager will review", { description: detail });
			} else {
				toast.error("Could not post minibar", { description: detail });
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg" data-testid="minibar-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<Wine className="size-4" /> Minibar · {roomLabel ?? stay}
					</SheetTitle>
					<SheetDescription>
						{guestName ? `${guestName} · ` : ""}
						posts one folio line per submission.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
					<div>
						<Label className="text-xs">Consumed at</Label>
						<Input
							type="datetime-local"
							value={consumedAt}
							onChange={(e) => setConsumedAt(e.target.value)}
							data-testid="minibar-consumed-at"
						/>
						{hoursBack > 24 ? (
							<div className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
								<AlertTriangle className="size-3" />
								Back-dating &gt; 24h will require manager approval.
							</div>
						) : null}
					</div>

					{items === null ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading catalog…
						</div>
					) : items.length === 0 ? (
						<div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
							No minibar catalog yet — set one up in Property management.
						</div>
					) : (
						<>
							<div className="flex flex-wrap gap-1">
								{categories.map((c) => (
									<Button
										key={c}
										size="sm"
										variant={category === c ? "default" : "outline"}
										className="h-7 px-2 text-xs"
										onClick={() => setCategory(c)}
										data-testid={`cat-${c}`}
									>
										{c}
									</Button>
								))}
							</div>

							<motion.div
								className="flex flex-col divide-y rounded-md border"
								variants={staggerContainer}
								initial="hidden"
								animate="show"
							>
								{filtered.map((i) => {
									const q = basket[i.name] ?? 0;
									return (
										<motion.div
											key={i.name}
											variants={staggerItem}
											className="flex items-center justify-between gap-2 p-2"
											data-testid={`item-${i.item_code_short}`}
										>
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm font-medium">{i.item_name}</div>
												<div className="text-xs text-muted-foreground">{formatINR(i.price)}</div>
											</div>
											<div className="flex items-center gap-2">
												<Button
													variant="ghost"
													size="icon"
													aria-label={`${i.item_name} minus`}
													onClick={() => bump(i.name, -1)}
													disabled={q === 0}
													data-testid={`minus-${i.item_code_short}`}
												>
													<Minus className="size-3.5" />
												</Button>
												<span className="w-4 text-center text-sm font-medium tabular-nums">{q}</span>
												<Button
													variant="ghost"
													size="icon"
													aria-label={`${i.item_name} plus`}
													onClick={() => bump(i.name, 1)}
													data-testid={`plus-${i.item_code_short}`}
												>
													<Plus className="size-3.5" />
												</Button>
											</div>
										</motion.div>
									);
								})}
							</motion.div>
						</>
					)}

					<div>
						<Label className="text-xs">Notes for folio (optional)</Label>
						<Input
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							placeholder="e.g. Late-night order"
							data-testid="minibar-notes"
						/>
					</div>

					{recent.length > 0 ? (
						<div>
							<div className="mb-1 text-xs text-muted-foreground">Recent postings</div>
							<div className="flex flex-col divide-y rounded-md border">
								{recent.map((p) => (
									<a
										key={p.name}
										href={p.folio_line ? `#/folio/${encodeURIComponent(p.folio_line.split(":")[0] || "")}` : "#"}
										className="flex items-center justify-between p-2 text-xs hover:bg-accent/40"
									>
										<div className="min-w-0">
											<div className="truncate font-medium">
												{p.items.slice(0, 3).map((it) => `${it.quantity}× ${it.item_name}`).join(", ")}
												{p.items.length > 3 ? "…" : ""}
											</div>
											<div className="text-muted-foreground">{fmtDT(p.consumed_at)} · {p.state}</div>
										</div>
										<span className="text-sm font-medium">{formatINR(p.total_amount)}</span>
									</a>
								))}
							</div>
						</div>
					) : null}
				</div>

				<SheetFooter className="border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2">
						<Badge variant="secondary">
							{totalItems} item{totalItems === 1 ? "" : "s"} · {formatINR(subtotal)}
						</Badge>
					</div>
					<div className="flex gap-2">
						<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
						<Button
							onClick={post}
							disabled={busy || totalItems === 0}
							data-testid="minibar-post"
						>
							{busy ? <Loader2 className="size-4 animate-spin" /> : null}
							Post to folio
						</Button>
					</div>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
