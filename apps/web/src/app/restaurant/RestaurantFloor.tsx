/**
 * RestaurantFloor — outlet picker + live floor plan (spec 006 slice 3).
 *
 * Front-of-house home screen: pick an outlet, see every table tinted by live
 * status, open an occupied table's order, or start a walk-in. Live-with-mock
 * fallback so it renders before the backend deploys.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChefHat, Loader2, Plus, RefreshCw, Users } from "lucide-react";
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
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatINR } from "@/components/fnb/menu-visuals";
import { FolioApiError } from "@/lib/folio-api";
import { listOutlets, type FnbOutlet } from "@/lib/fnb-api";
import {
	MOCK_TABLES,
	listTables,
	openWalkInOrder,
	pickDineInOutlet,
	type RestaurantTable,
} from "@/lib/restaurant-api";

import { formatElapsed, tableTone } from "./restaurant-format";

type LoadState = "loading" | "live" | "mock";

export default function RestaurantFloor() {
	const [outlets, setOutlets] = useState<FnbOutlet[]>([]);
	const [outlet, setOutlet] = useState<string>("");
	const [tables, setTables] = useState<RestaurantTable[]>([]);
	const [state, setState] = useState<LoadState>("loading");
	const [starting, setStarting] = useState(false);

	useEffect(() => {
		listOutlets()
			.then((res) => {
				setOutlets(res.outlets);
				const def = pickDineInOutlet(res.outlets);
				if (def) setOutlet(def.name);
				else setState("mock");
			})
			.catch(() => {
				setOutlets([{ name: "Signature Restaurant", outlet_name: "Signature Restaurant", outlet_code: "SIGREST", outlet_type: "Restaurant", is_default: 1, default_service_charge_pct: null }]);
				setOutlet("Signature Restaurant");
			});
	}, []);

	const load = useCallback((outletName: string) => {
		if (!outletName) return;
		setState("loading");
		listTables(outletName)
			.then((res) => {
				setTables(res.tables);
				setState("live");
			})
			.catch((error: unknown) => {
				// A live server that errors (bad outlet, permission) gets an empty
				// live floor + a toast — NOT fake mock tables. Only a true network
				// failure (no FolioApiError) falls back to the dev fixtures.
				if (error instanceof FolioApiError) {
					toast.error("Could not load tables", { description: error.blockers[0]?.message ?? error.message });
					setTables([]);
					setState("live");
					return;
				}
				setTables(MOCK_TABLES);
				setState("mock");
			});
	}, []);

	useEffect(() => {
		if (outlet) load(outlet);
	}, [outlet, load]);

	async function startWalkIn(table?: RestaurantTable) {
		if (!outlet || starting) return;
		setStarting(true);
		try {
			const res = await openWalkInOrder({ outlet, table: table?.name, party_size: table?.seats ?? 2 });
			window.location.hash = `#/restaurant/table/${encodeURIComponent(res.order.name)}`;
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not open order", { description: msg });
		} finally {
			setStarting(false);
		}
	}

	function openTable(table: RestaurantTable) {
		if (table.open_order) {
			window.location.hash = `#/restaurant/table/${encodeURIComponent(table.open_order.name)}`;
		} else {
			void startWalkIn(table);
		}
	}

	const zones = Array.from(new Set(tables.map((t) => t.zone)));
	const occupied = tables.filter((t) => t.open_order).length;

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<Badge variant="outline">{state === "live" ? "Live floor" : state === "loading" ? "Loading" : "Mock floor"}</Badge>
						<Badge variant="secondary">Restaurant POS</Badge>
					</div>
					<h1 className="font-display text-3xl font-light tracking-tight">Floor plan</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{occupied} of {tables.length} tables occupied
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Select value={outlet} onValueChange={setOutlet}>
						<SelectTrigger className="w-52" data-testid="restaurant-outlet">
							<SelectValue placeholder="Choose outlet" />
						</SelectTrigger>
						<SelectContent>
							{outlets.map((o) => (
								<SelectItem key={o.name} value={o.name}>{o.outlet_name}</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button variant="outline" size="icon" aria-label="Refresh" onClick={() => load(outlet)}>
						<RefreshCw className="size-4" />
					</Button>
					<Button variant="outline" asChild>
						<a href="#/restaurant/kitchen"><ChefHat className="mr-1.5 size-4" /> Kitchen</a>
					</Button>
					<Button
						className="bg-brass text-brass-foreground hover:bg-brass/90"
						onClick={() => startWalkIn()}
						disabled={starting}
						data-testid="restaurant-new-walkin"
					>
						{starting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plus className="mr-1.5 size-4" />}
						New walk-in
					</Button>
				</div>
			</div>

			{state === "loading" ? (
				<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading floor…
				</div>
			) : tables.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
					<Users className="size-7 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">No tables in this outlet. Pick another outlet above.</p>
				</div>
			) : (
				<div className="flex flex-col gap-7">
					{zones.map((zone) => (
						<section key={zone}>
							<div className="mb-3 flex items-baseline gap-2">
								<h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{zone}</h2>
								<span className="text-[11px] text-muted-foreground/70">
									{tables.filter((t) => t.zone === zone).length} tables
								</span>
							</div>
							<motion.div
								className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
								variants={staggerContainer}
								initial="hidden"
								animate="show"
							>
								{tables
									.filter((t) => t.zone === zone)
									.map((table) => (
										<TableCard key={table.name} table={table} onOpen={() => openTable(table)} />
									))}
							</motion.div>
						</section>
					))}
				</div>
			)}
		</main>
	);
}

function TableCard({ table, onOpen }: { table: RestaurantTable; onOpen: () => void }) {
	const tone = tableTone(table.live_status);
	const order = table.open_order;
	return (
		<motion.button
			variants={staggerItem}
			type="button"
			onClick={onOpen}
			data-testid={`table-${table.table_code}`}
			className={`flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors hover:border-brass/40 ${tone.tint}`}
		>
			<div className="flex items-start justify-between">
				<div>
					<div className="font-display text-lg font-normal leading-none">{table.table_code}</div>
					<div className="mt-1 text-xs text-muted-foreground">{table.table_name}</div>
				</div>
				<span className={`mt-1 size-2.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
			</div>
			<div className="flex items-center gap-3 text-[11px] text-muted-foreground">
				<span className="inline-flex items-center gap-1"><Users className="size-3" /> {table.seats}</span>
				<span className={`font-medium ${tone.text}`}>{tone.label}</span>
			</div>
			{order ? (
				<div className="mt-auto border-t pt-2 text-[11px]">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">{order.guest_name ?? "Walk-in"}</span>
						<span className="font-mono tabular-nums">{formatINR(order.grand_total)}</span>
					</div>
					<div className="mt-0.5 flex items-center justify-between text-muted-foreground/70">
						<span>{order.kot_number ?? "no KOT yet"}</span>
						<span>{formatElapsed(order.opened_at)}</span>
					</div>
				</div>
			) : (
				<div className="mt-auto border-t pt-2 text-[11px] text-muted-foreground/60">Tap to seat</div>
			)}
		</motion.button>
	);
}
