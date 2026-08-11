/**
 * ItemCartRail — the POS cart (spec 006). Sticky right-rail on tablet/desktop;
 * host collapses it to a bottom sheet on phone. Presentational: it owns no
 * order logic, just renders the current basket over the known MenuItem list
 * and calls back on qty change / submit. Payment semantics (send-to-kitchen,
 * room-charge, walk-in SI, split) are decided by the hosting screen once the
 * restaurant API contract lands.
 *
 * Every cart line carries the shared MenuItemThumb so imagery stays
 * consistent with the menu grid and IRD sheet.
 */

import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MenuItem } from "@/lib/fnb-api";

import { MenuItemThumb, formatINR } from "./menu-visuals";

export type CartBasket = Record<string, number>;

export function ItemCartRail({
	items,
	basket,
	onAdd,
	onRemove,
	onClear,
	submitLabel,
	onSubmit,
	submitting = false,
	footerSlot,
}: {
	items: MenuItem[];
	basket: CartBasket;
	onAdd: (name: string) => void;
	onRemove: (name: string) => void;
	onClear?: () => void;
	submitLabel: string;
	onSubmit: () => void;
	submitting?: boolean;
	footerSlot?: React.ReactNode;
}) {
	const byName = new Map(items.map((i) => [i.name, i]));
	const lines = Object.entries(basket)
		.filter(([, qty]) => qty > 0)
		.map(([name, qty]) => ({ item: byName.get(name), qty }))
		.filter((l): l is { item: MenuItem; qty: number } => !!l.item);

	const count = lines.reduce((s, l) => s + l.qty, 0);
	const subtotal = lines.reduce((s, l) => s + l.item.price * l.qty, 0);

	return (
		<div className="flex h-full flex-col rounded-xl border bg-card">
			<div className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-2">
					<ShoppingCart className="size-4" />
					<span className="font-display text-base font-normal">Order</span>
					{count > 0 ? (
						<span className="rounded-full bg-brass/15 px-2 py-0.5 text-xs font-medium text-brass">
							{count}
						</span>
					) : null}
				</div>
				{count > 0 && onClear ? (
					<Button variant="ghost" size="icon" className="size-10 md:size-7" aria-label="Clear order" onClick={onClear}>
						<Trash2 className="size-3.5" />
					</Button>
				) : null}
			</div>

			<div className="flex-1 overflow-y-auto">
				{lines.length === 0 ? (
					<div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
						<ShoppingCart className="size-6 text-muted-foreground/50" />
						<p className="text-sm text-muted-foreground">No items yet — tap a dish to start the order.</p>
					</div>
				) : (
					<div className="divide-y">
						{lines.map(({ item, qty }) => (
							<div key={item.name} className="flex items-center gap-3 px-4 py-2.5">
								<MenuItemThumb
									src={item.image}
									category={item.category}
									name={item.item_name}
									vegFlag={item.veg_flag}
									size="sm"
								/>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">{item.item_name}</div>
									<div className="text-[11px] text-muted-foreground">
										{formatINR(item.price)} · line {formatINR(item.price * qty)}
									</div>
								</div>
								<div className="flex items-center gap-1">
									<Button
										variant="ghost"
										size="icon"
										className="size-10 md:size-7"
										aria-label={`${item.item_name} minus`}
										onClick={() => onRemove(item.name)}
									>
										<Minus className="size-3.5" />
									</Button>
									<span className="w-5 text-center text-sm font-medium tabular-nums">{qty}</span>
									<Button
										variant="ghost"
										size="icon"
										className="size-10 md:size-7"
										aria-label={`${item.item_name} plus`}
										onClick={() => onAdd(item.name)}
									>
										<Plus className="size-3.5" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			<div className="border-t p-4">
				{footerSlot}
				<div className="mb-3 flex items-baseline justify-between">
					<span className="text-sm text-muted-foreground">Subtotal</span>
					<span className="font-display text-xl font-light tabular-nums">{formatINR(subtotal)}</span>
				</div>
				<Button
					className="w-full bg-brass text-brass-foreground hover:bg-brass/90"
					disabled={count === 0 || submitting}
					onClick={onSubmit}
					data-testid="cart-submit"
				>
					{submitLabel}
				</Button>
			</div>
		</div>
	);
}
