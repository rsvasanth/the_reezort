/**
 * Table move sheet — spec 006 Workflow 4. Transfer an open order to a vacant
 * table (guest changed seats) or merge it with another table's open order
 * (two parties joining into one bill).
 */

import { useEffect, useState } from "react";
import { ArrowRightLeft, Loader2, Merge, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FolioApiError } from "@/lib/folio-api";
import { formatINR } from "@/components/fnb/menu-visuals";
import {
	listTables,
	mergeOrders,
	transferTable,
	type RestaurantOrder,
	type RestaurantTable,
} from "@/lib/restaurant-api";

function errMessage(error: unknown): string {
	return error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
}

export function TableMoveSheet({
	order,
	open,
	onOpenChange,
	onDone,
}: {
	order: RestaurantOrder;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDone: () => void;
}) {
	const [tables, setTables] = useState<RestaurantTable[]>([]);
	const [busy, setBusy] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !order.outlet) return;
		listTables(order.outlet)
			.then((r) => setTables(r.tables))
			.catch(() => setTables([]));
	}, [open, order.outlet]);

	const vacant = tables.filter((t) => t.live_status === "Vacant" && t.name !== order.table);
	const otherOpen = tables.filter((t) => t.open_order && t.open_order.name !== order.name);

	async function doTransfer(table: RestaurantTable) {
		setBusy(table.name);
		try {
			await transferTable(order.name, table.name);
			toast.success(`Moved to ${table.table_name ?? table.table_code}`);
			onDone();
			onOpenChange(false);
		} catch (error) {
			toast.error("Could not transfer", { description: errMessage(error) });
		} finally {
			setBusy(null);
		}
	}

	async function doMerge(table: RestaurantTable) {
		const other = table.open_order;
		if (!other) return;
		setBusy(table.name);
		try {
			await mergeOrders(order.name, other.name);
			toast.success(`Merged ${table.table_name ?? table.table_code} into this bill`);
			onDone();
			onOpenChange(false);
		} catch (error) {
			toast.error("Could not merge", { description: errMessage(error) });
		} finally {
			setBusy(null);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="table-move-sheet">
				<SheetHeader>
					<SheetTitle>Move / merge · {order.table ?? order.name}</SheetTitle>
					<SheetDescription>{order.kot_number ?? order.name}</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-4 overflow-y-auto p-4">
					<Tabs defaultValue="transfer" className="w-full">
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="transfer">
								<ArrowRightLeft className="mr-1.5 size-3.5" /> Transfer
							</TabsTrigger>
							<TabsTrigger value="merge">
								<Merge className="mr-1.5 size-3.5" /> Merge
							</TabsTrigger>
						</TabsList>

						<TabsContent value="transfer" className="flex flex-col gap-2 pt-3">
							<p className="text-xs text-muted-foreground">Move this order to a vacant table.</p>
							{vacant.length === 0 ? (
								<p className="py-6 text-center text-sm text-muted-foreground">No vacant tables.</p>
							) : (
								vacant.map((t) => (
									<Button
										key={t.name}
										variant="outline"
										className="justify-between"
										disabled={busy !== null}
										onClick={() => doTransfer(t)}
										data-testid={`transfer-${t.name}`}
									>
										<span>{t.table_name ?? t.table_code}</span>
										{busy === t.name ? <Loader2 className="size-4 animate-spin" /> : <span className="text-xs text-muted-foreground">{t.zone}</span>}
									</Button>
								))
							)}
						</TabsContent>

						<TabsContent value="merge" className="flex flex-col gap-2 pt-3">
							<p className="text-xs text-muted-foreground">
								Pull another table's open order into this bill. The other order is closed out.
							</p>
							{otherOpen.length === 0 ? (
								<p className="py-6 text-center text-sm text-muted-foreground">No other open orders.</p>
							) : (
								otherOpen.map((t) => (
									<Button
										key={t.name}
										variant="outline"
										className="h-auto flex-col items-start gap-0.5 py-2"
										disabled={busy !== null}
										onClick={() => doMerge(t)}
										data-testid={`merge-${t.name}`}
									>
										<span className="flex w-full items-center justify-between">
											<span>{t.table_name ?? t.table_code}</span>
											{busy === t.name ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<span className="font-mono text-xs tabular-nums">{formatINR(t.open_order?.grand_total ?? 0)}</span>
											)}
										</span>
										<span className="text-[11px] text-muted-foreground">
											{t.open_order?.guest_name ?? t.open_order?.kot_number ?? "Open order"}
										</span>
									</Button>
								))
							)}
						</TabsContent>
					</Tabs>
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
