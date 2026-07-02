/**
 * TableOrderScreen — order detail / cart for one Restaurant Order (spec 006).
 *
 * Left: filterable menu grid (image-forward MenuItemCard). Right: the order
 * rail — items already sent, a cart for the next round, and the forward
 * action (send to kitchen → charge / close walk-in). Live-with-mock fallback.
 *
 * Split-bill is Slice 4 proper (helpers TBD backend) — this screen closes a
 * walk-in with a single cash payment for now; the seam is the onSettle path.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Loader2, Lock, Search, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MenuItemCard } from "@/components/fnb/menu-item-card";
import { ItemCartRail, type CartBasket } from "@/components/fnb/item-cart-rail";
import { MenuItemThumb, formatINR, parseTags } from "@/components/fnb/menu-visuals";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import { listMenuItems, type MenuItem } from "@/lib/fnb-api";
import {
	MOCK_KOTS,
	addItems,
	closeWalkIn,
	getOrder,
	sendToKitchen,
	type RestaurantOrder,
} from "@/lib/restaurant-api";

import { lineStatusTone, orderStateTone } from "./restaurant-format";

type LoadState = "loading" | "live" | "mock" | "error";

const CAN_ADD_STATES = new Set(["Draft", "Sent to Kitchen", "Preparing", "Ready", "Served"]);

export default function TableOrderScreen({ order: orderName }: { order: string | null }) {
	const [order, setOrder] = useState<RestaurantOrder | null>(null);
	const [state, setState] = useState<LoadState>("loading");
	const [items, setItems] = useState<MenuItem[]>([]);
	const [category, setCategory] = useState("__all");
	const [search, setSearch] = useState("");
	const [basket, setBasket] = useState<CartBasket>({});
	const [busy, setBusy] = useState(false);

	const loadOrder = useCallback(() => {
		if (!orderName) {
			setState("error");
			return;
		}
		setState("loading");
		getOrder(orderName)
			.then((res) => {
				setOrder(res.order);
				setState("live");
			})
			.catch(() => {
				// Dev/mock fallback: if the name matches a fixture (the mock floor
				// links to mock orders), render it; otherwise it's a genuine miss.
				const mock = MOCK_KOTS.find((o) => o.name === orderName);
				if (mock) {
					setOrder(mock);
					setState("mock");
					return;
				}
				setState("error");
			});
	}, [orderName]);

	useEffect(() => {
		loadOrder();
	}, [loadOrder]);

	useEffect(() => {
		if (!order?.outlet) return;
		listMenuItems(order.outlet)
			.then((res) => setItems(res.items))
			.catch(() => setItems([]));
	}, [order?.outlet]);

	const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category))), [items]);
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return items.filter((i) => {
			if (category !== "__all" && i.category !== category) return false;
			if (q) {
				const hay = `${i.item_name} ${i.description ?? ""} ${parseTags(i.tags).join(" ")}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}, [items, category, search]);

	function bump(name: string, delta: number) {
		setBasket((prev) => {
			const next = { ...prev };
			const q = Math.max(0, (next[name] ?? 0) + delta);
			if (q === 0) delete next[name];
			else next[name] = q;
			return next;
		});
	}

	const basketCount = Object.values(basket).reduce((s, q) => s + q, 0);

	async function sendRound() {
		if (!order || basketCount === 0 || busy) return;
		setBusy(true);
		try {
			const payload = Object.entries(basket).map(([menu_item, quantity]) => ({ menu_item, quantity }));
			await addItems(order.name, payload);
			const res = await sendToKitchen(order.name);
			setOrder(res.order);
			setBasket({});
			toast.success("Sent to kitchen", { description: res.order.kot_number ?? undefined });
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not send order", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	async function settle() {
		if (!order || busy) return;
		setBusy(true);
		try {
			const res = await closeWalkIn(order.name, [{ mode_of_payment: "Cash", amount: order.grand_total }]);
			setOrder(res.order);
			toast.success("Walk-in settled", { description: res.sales_invoice });
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not settle", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	if (state === "loading") {
		return (
			<main className="flex flex-1 items-center justify-center bg-background">
				<Loader2 className="size-6 animate-spin text-muted-foreground" />
			</main>
		);
	}

	if (state === "error" || !order) {
		return (
			<main className="flex flex-1 flex-col items-center justify-center gap-3 bg-background">
				<p className="text-sm text-muted-foreground">Order not found.</p>
				<Button variant="outline" asChild><a href="#/restaurant"><ArrowLeft className="mr-1.5 size-4" /> Back to floor</a></Button>
			</main>
		);
	}

	const tone = orderStateTone(order.state);
	const canAdd = CAN_ADD_STATES.has(order.state);
	const canSettle = order.state === "Served" || order.state === "Bill Pending";

	return (
		<main className="flex flex-1 flex-col gap-4 bg-background px-4 py-6 lg:px-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" aria-label="Back to floor" asChild>
						<a href="#/restaurant"><ArrowLeft className="size-4" /></a>
					</Button>
					<div>
						<div className="flex items-center gap-2">
							<h1 className="font-display text-2xl font-light tracking-tight">
								{order.table ?? "Walk-in"}
							</h1>
							<Badge variant="secondary" className={tone.text}>{tone.label}</Badge>
							{state === "mock" ? <Badge variant="outline">Mock</Badge> : null}
						</div>
						<div className="mt-0.5 font-mono text-xs text-muted-foreground">
							{order.name}{order.kot_number ? ` · ${order.kot_number}` : ""} · {order.party_size} covers
						</div>
					</div>
				</div>
			</div>

			<div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
				{/* Menu grid — hidden once the order is closed (Settled / Cancelled),
				    so a closed order shows a clear banner instead of 86'ing every dish. */}
				<div className="flex flex-col gap-3">
					{!canAdd ? (
						<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
							<Lock className="size-6 text-muted-foreground/50" />
							<p className="text-sm text-muted-foreground">
								This order is {order.state.toLowerCase()} — no further items can be added.
							</p>
						</div>
					) : (
						<>
							<div className="flex flex-col gap-2">
								<div className="relative">
									<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input className="pl-8" placeholder="Search the menu…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="menu-search" />
								</div>
								<div className="flex flex-wrap gap-1">
									<Button size="sm" variant={category === "__all" ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setCategory("__all")}>All</Button>
									{categories.map((c) => (
										<Button key={c} size="sm" variant={category === c ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setCategory(c)}>{c}</Button>
									))}
								</div>
							</div>

							{items.length === 0 ? (
								<div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
									No menu items for this outlet.
								</div>
							) : (
								<motion.div
									className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
									variants={staggerContainer}
									initial="hidden"
									animate="show"
								>
									{filtered.map((item) => (
										<motion.div key={item.name} variants={staggerItem}>
											<MenuItemCard
												item={item}
												qty={basket[item.name] ?? 0}
												onAdd={() => bump(item.name, 1)}
												onRemove={() => bump(item.name, -1)}
											/>
										</motion.div>
									))}
								</motion.div>
							)}
						</>
					)}
				</div>

				{/* Order rail */}
				<div className="flex flex-col gap-4 xl:sticky xl:top-4">
					{order.items.length > 0 ? (
						<div className="rounded-xl border bg-card">
							<div className="border-b px-4 py-3">
								<h2 className="font-display text-base font-normal">On the order</h2>
							</div>
							<div className="divide-y">
								{order.items.map((it) => (
									<div key={it.name} className="flex items-center gap-2.5 px-4 py-2 text-sm">
										<MenuItemThumb
											src={it.image}
											category={it.category ?? "Other"}
											name={it.item_name}
											vegFlag={it.veg_flag ?? undefined}
											size="sm"
										/>
										<span className="font-mono tabular-nums text-muted-foreground">{it.quantity}×</span>
										<span className={`min-w-0 flex-1 truncate ${lineStatusTone(it.line_status)}`}>{it.item_name}</span>
										<span className="font-mono text-xs tabular-nums">{formatINR(it.amount)}</span>
									</div>
								))}
							</div>
							<div className="flex items-center justify-between border-t px-4 py-2.5 text-sm">
								<span className="text-muted-foreground">Running total</span>
								<span className="font-mono font-medium tabular-nums">{formatINR(order.grand_total)}</span>
							</div>
							{canSettle ? (
								<div className="p-3 pt-0">
									<Button className="w-full" disabled={busy} onClick={settle} data-testid="order-settle">
										{busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
										Close &amp; settle (cash · {formatINR(order.grand_total)})
									</Button>
								</div>
							) : null}
						</div>
					) : null}

					{canAdd ? (
						<div className="h-[26rem]">
							<ItemCartRail
								items={items}
								basket={basket}
								onAdd={(n) => bump(n, 1)}
								onRemove={(n) => bump(n, -1)}
								onClear={() => setBasket({})}
								submitLabel={busy ? "Sending…" : "Send to kitchen"}
								onSubmit={sendRound}
								submitting={busy}
								footerSlot={
									<div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
										<Send className="size-3" /> New items dispatch as a fresh KOT round.
									</div>
								}
							/>
						</div>
					) : null}
				</div>
			</div>
		</main>
	);
}
