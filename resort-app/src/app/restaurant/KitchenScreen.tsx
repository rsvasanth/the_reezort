/**
 * KitchenScreen — the KOT queue for kitchen staff (spec 006 slice 3).
 *
 * Tickets in Sent to Kitchen / Preparing / Ready, each with an elapsed timer
 * and one forward action (Start → Ready → Served). Auto-refreshes so new
 * tickets animate in. Live-with-mock fallback for pre-deploy dev.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChefHat, Clock, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { EASE_OUT } from "@/lib/motion";
import { MenuItemThumb } from "@/components/fnb/menu-visuals";
import { FolioApiError } from "@/lib/folio-api";
import { listOutlets, type FnbOutlet } from "@/lib/fnb-api";
import {
	MOCK_KOTS,
	listActiveKots,
	markKotStatus,
	pickDineInOutlet,
	type RestaurantOrder,
} from "@/lib/restaurant-api";

import { formatElapsed, lineStatusTone, orderStateTone } from "./restaurant-format";

type LoadState = "loading" | "live" | "mock";

const REFRESH_MS = 20000;

export default function KitchenScreen() {
	const [outlets, setOutlets] = useState<FnbOutlet[]>([]);
	const [outlet, setOutlet] = useState<string>("");
	const [orders, setOrders] = useState<RestaurantOrder[]>([]);
	const [state, setState] = useState<LoadState>("loading");
	const [busy, setBusy] = useState<string | null>(null);

	useEffect(() => {
		listOutlets()
			.then((res) => {
				setOutlets(res.outlets);
				const def = pickDineInOutlet(res.outlets);
				if (def) setOutlet(def.name);
			})
			.catch(() => {
				setOutlets([{ name: "Signature Restaurant", outlet_name: "Signature Restaurant", outlet_code: "SIGREST", outlet_type: "Restaurant", is_default: 1, default_service_charge_pct: null }]);
				setOutlet("Signature Restaurant");
			});
	}, []);

	const load = useCallback((outletName: string, quiet = false) => {
		if (!outletName) return;
		if (!quiet) setState("loading");
		listActiveKots(outletName)
			.then((res) => {
				setOrders(res.orders);
				setState("live");
			})
			.catch((error: unknown) => {
				// Live server error → empty queue, not fake tickets; only a network
				// failure falls back to the dev fixtures.
				if (error instanceof FolioApiError) {
					setOrders([]);
					setState("live");
					return;
				}
				setOrders(MOCK_KOTS);
				setState("mock");
			});
	}, []);

	useEffect(() => {
		if (!outlet) return;
		load(outlet);
		const t = window.setInterval(() => load(outlet, true), REFRESH_MS);
		return () => window.clearInterval(t);
	}, [outlet, load]);

	async function advance(order: RestaurantOrder, status: "Preparing" | "Ready" | "Served") {
		setBusy(order.name);
		try {
			await markKotStatus(order.name, status);
			toast.success(`${order.kot_number ?? order.name} → ${status}`);
			load(outlet, true);
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not update ticket", { description: msg });
		} finally {
			setBusy(null);
		}
	}

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<Badge variant="outline">{state === "live" ? "Live KOT" : state === "loading" ? "Loading" : "Mock KOT"}</Badge>
						<Badge variant="secondary">Kitchen</Badge>
					</div>
					<h1 className="font-display text-3xl font-light tracking-tight">Kitchen queue</h1>
					<p className="mt-1 text-sm text-muted-foreground">{orders.length} active ticket{orders.length === 1 ? "" : "s"}</p>
				</div>
				<div className="flex items-center gap-2">
					<Select value={outlet} onValueChange={setOutlet}>
						<SelectTrigger className="w-52"><SelectValue placeholder="Choose outlet" /></SelectTrigger>
						<SelectContent>
							{outlets.map((o) => <SelectItem key={o.name} value={o.name}>{o.outlet_name}</SelectItem>)}
						</SelectContent>
					</Select>
					<Button variant="outline" size="icon" aria-label="Refresh" onClick={() => load(outlet)}>
						<RefreshCw className="size-4" />
					</Button>
					<Button variant="outline" asChild>
						<a href="#/restaurant">Floor plan</a>
					</Button>
				</div>
			</div>

			{state === "loading" ? (
				<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading tickets…
				</div>
			) : orders.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
					<ChefHat className="size-7 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">No active tickets. New orders appear here automatically.</p>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					<AnimatePresence mode="popLayout">
						{orders.map((order) => (
							<KotTicket key={order.name} order={order} busy={busy === order.name} onAdvance={advance} />
						))}
					</AnimatePresence>
				</div>
			)}
		</main>
	);
}

function KotTicket({
	order,
	busy,
	onAdvance,
}: {
	order: RestaurantOrder;
	busy: boolean;
	onAdvance: (order: RestaurantOrder, status: "Preparing" | "Ready" | "Served") => void;
}) {
	const tone = orderStateTone(order.state);
	const elapsed = formatElapsed(order.sent_to_kitchen_at ?? order.opened_at);
	const next = nextAction(order.state);

	return (
		<motion.div
			layout
			initial={{ opacity: 0, scale: 0.96 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{ opacity: 0, scale: 0.96 }}
			transition={{ duration: 0.25, ease: EASE_OUT }}
			className="flex flex-col rounded-xl border bg-card"
		>
			<div className={`flex items-center justify-between rounded-t-xl px-4 py-2.5 ${tone.tint}`}>
				<span className="font-mono text-sm font-medium">{order.kot_number ?? order.name}</span>
				<span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tone.text}`}>
					<Clock className="size-3" /> {elapsed}
				</span>
			</div>
			<div className="flex items-center justify-between border-b px-4 py-2 text-[11px] text-muted-foreground">
				<span>{order.table ?? "Walk-in"} · {order.party_size} cover{order.party_size === 1 ? "" : "s"}</span>
				<span className={tone.text}>{tone.label}</span>
			</div>

			<div className="flex-1 divide-y px-4">
				{order.items.map((it) => (
					<div key={it.name} className="flex items-start gap-2.5 py-2 text-sm">
						<MenuItemThumb
							src={it.image}
							category={it.category ?? "Other"}
							name={it.item_name}
							vegFlag={it.veg_flag ?? undefined}
							size="sm"
						/>
						<span className="mt-1 font-mono tabular-nums text-muted-foreground">{it.quantity}×</span>
						<div className="min-w-0 flex-1">
							<div className={`mt-0.5 ${lineStatusTone(it.line_status)}`}>{it.item_name}</div>
							{it.chef_note ? <div className="text-[11px] text-amber-600 dark:text-amber-400">· {it.chef_note}</div> : null}
						</div>
					</div>
				))}
			</div>

			{order.chef_notes ? (
				<div className="mx-4 mb-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-300">
					{order.chef_notes}
				</div>
			) : null}

			{next ? (
				<div className="p-3 pt-1">
					<Button
						className="w-full"
						variant={next.status === "Ready" ? "default" : "outline"}
						disabled={busy}
						onClick={() => onAdvance(order, next.status)}
						data-testid={`kot-advance-${order.name}`}
					>
						{busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
						{next.label}
					</Button>
				</div>
			) : null}
		</motion.div>
	);
}

function nextAction(state: RestaurantOrder["state"]): { status: "Preparing" | "Ready" | "Served"; label: string } | null {
	switch (state) {
		case "Sent to Kitchen":
			return { status: "Preparing", label: "Start preparing" };
		case "Preparing":
			return { status: "Ready", label: "Mark ready" };
		case "Ready":
			return { status: "Served", label: "Mark served" };
		default:
			return null;
	}
}
