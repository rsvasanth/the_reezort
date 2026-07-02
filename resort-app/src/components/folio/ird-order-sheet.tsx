/**
 * IRD Order Sheet — Front Desk in-room-dining order flow (spec 006 · Slice 1).
 *
 * Optimised for phone-order:
 *  · Instant fuzzy search across name + description + tags
 *  · Tag chips for one-tap discovery ("Kid friendly", "Chef pick")
 *  · Text-dense line rows with spice/allergens/prep inline
 *  · Live cart footer with chef notes + guest note
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
	AlertTriangle, Flame, Leaf, Loader2, Minus, Plus, Search, UtensilsCrossed,
} from "lucide-react";
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
	listMenuItems,
	listOutlets,
	listRecentFnbOrders,
	postRoomChargeOrder,
	type FnbOrderRow,
	type FnbOutlet,
	type MenuItem,
} from "@/lib/fnb-api";

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

function parseTags(s: string | null | undefined): string[] {
	if (!s) return [];
	return s.split(",").map((t) => t.trim()).filter(Boolean);
}

function VegDot({ flag }: { flag: string }) {
	const color =
		flag === "Non-veg" ? "bg-red-500" :
		flag === "Egg" ? "bg-amber-500" :
		flag === "Vegan" ? "bg-emerald-600" :
		"bg-green-500"; // Veg
	return (
		<span
			className={`inline-block size-2.5 rounded-full ring-1 ring-black/10 ${color}`}
			aria-label={flag}
			title={flag}
		/>
	);
}

function SpiceIcons({ level }: { level: number }) {
	if (!level || level <= 0) return null;
	return (
		<span className="inline-flex" aria-label={`Spice ${level}/3`}>
			{Array.from({ length: level }).map((_, i) => (
				<Flame key={i} className="size-3 text-red-500" />
			))}
		</span>
	);
}

// Category → gradient for the fallback tile (matches the seeded PIL tiles).
const CATEGORY_GRADIENT: Record<string, string> = {
	Starters:   "from-orange-500 to-orange-900",
	Mains:      "from-rose-500 to-rose-950",
	Desserts:   "from-pink-400 to-fuchsia-900",
	Beverages:  "from-teal-500 to-slate-900",
	Alcohol:    "from-indigo-500 to-purple-950",
	Sides:      "from-amber-500 to-amber-900",
	Breakfast:  "from-yellow-500 to-orange-900",
	Other:      "from-lime-500 to-slate-900",
};

function ItemThumb({
	src,
	category,
	name,
	vegFlag,
}: {
	src: string | null;
	category: string;
	name: string;
	vegFlag: string;
}) {
	const gradient = CATEGORY_GRADIENT[category] ?? "from-stone-500 to-stone-900";
	const initial = name.trim().slice(0, 1).toUpperCase();
	return (
		<div className="relative size-14 shrink-0 overflow-hidden rounded-md ring-1 ring-black/10">
			{src ? (
				<img src={src} alt={name} className="h-full w-full object-cover" loading="lazy" />
			) : (
				<div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient}`}>
					<span className="font-serif text-lg text-white/90">{initial}</span>
				</div>
			)}
			<span className="pointer-events-none absolute bottom-1 left-1">
				<VegDot flag={vegFlag} />
			</span>
		</div>
	);
}

type Basket = Record<string, number>;

export function IrdOrderSheet({
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
	const [outlets, setOutlets] = useState<FnbOutlet[] | null>(null);
	const [outlet, setOutlet] = useState<string>("");
	const [items, setItems] = useState<MenuItem[] | null>(null);
	const [category, setCategory] = useState<string>("__all");
	const [search, setSearch] = useState<string>("");
	const [activeTag, setActiveTag] = useState<string>("");
	const [vegOnly, setVegOnly] = useState<boolean>(false);
	const [basket, setBasket] = useState<Basket>({});
	const [orderedAt, setOrderedAt] = useState<string>(nowLocalIso());
	const [chefNotes, setChefNotes] = useState<string>("");
	const [guestNote, setGuestNote] = useState<string>("");
	const [busy, setBusy] = useState(false);
	const [recent, setRecent] = useState<FnbOrderRow[]>([]);

	const loadOutlets = useCallback(async () => {
		try {
			const res = await listOutlets(resortProperty);
			setOutlets(res.outlets);
			if (res.outlets.length > 0) setOutlet(res.outlets[0].name);
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not load outlets", { description: detail });
		}
	}, [resortProperty]);

	const loadMenu = useCallback(async (outletName: string) => {
		setItems(null);
		try {
			const res = await listMenuItems(outletName);
			setItems(res.items);
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not load menu", { description: detail });
		}
	}, []);

	const loadRecent = useCallback(async () => {
		try {
			const res = await listRecentFnbOrders(stay, 5);
			setRecent(res.orders);
		} catch {
			setRecent([]);
		}
	}, [stay]);

	useEffect(() => {
		if (open) {
			setBasket({});
			setChefNotes("");
			setGuestNote("");
			setOrderedAt(nowLocalIso());
			setSearch("");
			setActiveTag("");
			setCategory("__all");
			setVegOnly(false);
			loadOutlets();
			loadRecent();
		}
	}, [open, loadOutlets, loadRecent]);

	useEffect(() => {
		if (outlet) loadMenu(outlet);
	}, [outlet, loadMenu]);

	const categories = useMemo(() => {
		if (!items) return [] as string[];
		return Array.from(new Set(items.map((i) => i.category)));
	}, [items]);

	const tags = useMemo(() => {
		if (!items) return [] as string[];
		const s = new Set<string>();
		for (const i of items) for (const t of parseTags(i.tags)) s.add(t);
		return Array.from(s);
	}, [items]);

	const filtered = useMemo(() => {
		if (!items) return [] as MenuItem[];
		const q = search.trim().toLowerCase();
		return items.filter((i) => {
			if (category !== "__all" && i.category !== category) return false;
			if (vegOnly && !(i.veg_flag === "Veg" || i.veg_flag === "Vegan")) return false;
			if (activeTag && !parseTags(i.tags).includes(activeTag)) return false;
			if (q) {
				const hay = `${i.item_name} ${i.description ?? ""} ${i.tags ?? ""}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}, [items, category, search, activeTag, vegOnly]);

	const subtotal = useMemo(() => {
		if (!items) return 0;
		return items.reduce((s, i) => s + (basket[i.name] || 0) * i.price, 0);
	}, [items, basket]);

	const totalCount = useMemo(
		() => Object.values(basket).reduce((s, q) => s + q, 0),
		[basket],
	);

	const hoursBack = useMemo(() => {
		const t = new Date(orderedAt).getTime();
		if (Number.isNaN(t)) return 0;
		return Math.max(0, (Date.now() - t) / 36e5);
	}, [orderedAt]);

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
		if (totalCount === 0) {
			toast.error("Add at least one item");
			return;
		}
		if (!outlet) return;
		setBusy(true);
		try {
			const payload = {
				stay,
				outlet,
				items: Object.entries(basket).map(([menu_item, quantity]) => ({ menu_item, quantity })),
				ordered_at: orderedAt.replace("T", " "),
				chef_notes: chefNotes || undefined,
				guest_note: guestNote || undefined,
			};
			const res = await postRoomChargeOrder(payload);
			toast.success(`Sent to kitchen · ${formatINR(res.total_amount)} to folio`, {
				description: res.reused ? "Already sent — reused folio line." : res.folio_line,
			});
			onOpenChange(false);
			onPosted?.();
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			if (typeof detail === "string" && detail.toLowerCase().includes("approval")) {
				toast.warning("Approval requested — a manager will review", { description: detail });
			} else {
				toast.error("Could not send order", { description: detail });
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-2xl" data-testid="ird-order-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<UtensilsCrossed className="size-4" /> In-Room Dining · {roomLabel ?? stay}
					</SheetTitle>
					<SheetDescription>
						{guestName ? `${guestName} · ` : ""}
						charges directly to the folio.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
					{/* Outlet + time */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<Label className="text-xs">Outlet</Label>
							<Select value={outlet} onValueChange={setOutlet}>
								<SelectTrigger data-testid="fnb-outlet">
									<SelectValue placeholder="Choose outlet" />
								</SelectTrigger>
								<SelectContent>
									{(outlets ?? []).map((o) => (
										<SelectItem key={o.name} value={o.name}>{o.outlet_name}</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label className="text-xs">Ordered at</Label>
							<Input
								type="datetime-local"
								value={orderedAt}
								onChange={(e) => setOrderedAt(e.target.value)}
								data-testid="fnb-ordered-at"
							/>
							{hoursBack > 24 ? (
								<div className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
									<AlertTriangle className="size-3" />
									Back-dating &gt; 24h will require manager approval.
								</div>
							) : null}
						</div>
					</div>

					{/* Search + filters */}
					<div className="flex flex-col gap-2">
						<div className="relative">
							<Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								className="pl-7"
								placeholder="Search chicken, coffee, kid meal…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								data-testid="fnb-search"
							/>
						</div>

						{/* Category chips */}
						<div className="flex flex-wrap gap-1">
							<Button
								size="sm"
								variant={category === "__all" ? "default" : "outline"}
								className="h-7 px-2 text-xs"
								onClick={() => setCategory("__all")}
							>
								All
							</Button>
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

						{/* Tag chips + veg toggle */}
						{(tags.length > 0 || true) ? (
							<div className="flex flex-wrap items-center gap-1">
								{tags.map((t) => (
									<button
										key={t}
										type="button"
										onClick={() => setActiveTag(activeTag === t ? "" : t)}
										className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${activeTag === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
										data-testid={`tag-${t}`}
									>
										{t}
									</button>
								))}
								<button
									type="button"
									onClick={() => setVegOnly((v) => !v)}
									className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${vegOnly ? "border-green-500 bg-green-500/10 text-green-700" : "hover:bg-accent"}`}
									data-testid="veg-only"
								>
									<Leaf className="size-3" /> Veg only
								</button>
							</div>
						) : null}
					</div>

					{/* Items */}
					{items === null ? (
						<div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading menu…
						</div>
					) : filtered.length === 0 ? (
						<div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
							No items match. Try clearing filters.
						</div>
					) : (
						<motion.div
							className="flex flex-col divide-y rounded-md border"
							variants={staggerContainer}
							initial="hidden"
							animate="show"
						>
							{filtered.map((i) => {
								const q = basket[i.name] ?? 0;
								const allergens = i.allergens;
								return (
									<motion.div
										key={i.name}
										variants={staggerItem}
										className="flex items-start gap-3 p-2.5"
										data-testid={`item-${i.item_code_short}`}
									>
										<ItemThumb
											src={i.image}
											category={i.category}
											name={i.item_name}
											vegFlag={i.veg_flag}
										/>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span className="truncate text-sm font-medium">{i.item_name}</span>
												<SpiceIcons level={i.spice_level ?? 0} />
											</div>
											{i.description ? (
												<div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{i.description}</div>
											) : null}
											<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
												<span className="font-medium text-foreground">{formatINR(i.price)}</span>
												{i.prep_time_minutes ? <span>· ~{i.prep_time_minutes}m</span> : null}
												{allergens ? <span>· Contains {allergens}</span> : null}
											</div>
										</div>
										<div className="flex items-center gap-1.5 self-center">
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
					)}

					{/* Notes */}
					<div className="grid gap-2 md:grid-cols-2">
						<div>
							<Label className="text-xs">Chef notes (allergy, prep)</Label>
							<Input
								value={chefNotes}
								onChange={(e) => setChefNotes(e.target.value)}
								placeholder="No nuts — allergy"
								data-testid="fnb-chef-notes"
							/>
						</div>
						<div>
							<Label className="text-xs">Guest note (ETA, swaps)</Label>
							<Input
								value={guestNote}
								onChange={(e) => setGuestNote(e.target.value)}
								placeholder="25 min ETA"
								data-testid="fnb-guest-note"
							/>
						</div>
					</div>

					{/* Recent orders */}
					{recent.length > 0 ? (
						<div>
							<div className="mb-1 text-xs text-muted-foreground">Recent orders for this stay</div>
							<div className="flex flex-col divide-y rounded-md border">
								{recent.map((o) => (
									<div key={o.name} className="flex items-center justify-between p-2 text-xs">
										<div className="min-w-0">
											<div className="truncate font-medium">
												{o.items.slice(0, 3).map((it) => `${it.quantity}× ${it.item_name}`).join(", ")}
												{o.items.length > 3 ? "…" : ""}
											</div>
											<div className="text-muted-foreground">{fmtDT(o.ordered_at)} · {o.outlet_name}</div>
										</div>
										<span className="text-sm font-medium">{formatINR(o.total_amount)}</span>
									</div>
								))}
							</div>
						</div>
					) : null}
				</div>

				<SheetFooter className="border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
					<Badge variant="secondary">
						{totalCount} item{totalCount === 1 ? "" : "s"} · {formatINR(subtotal)}
					</Badge>
					<div className="flex gap-2">
						<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
						<Button onClick={post} disabled={busy || totalCount === 0} data-testid="fnb-post">
							{busy ? <Loader2 className="size-4 animate-spin" /> : null}
							Send to kitchen &amp; charge folio
						</Button>
					</div>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
