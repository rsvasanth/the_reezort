/**
 * MenuItemCard — the image-forward POS grid tile (spec 006, `grid` density).
 *
 * Used by the walk-in POS tablet and table-detail menu grid. Photo on top
 * (4:3, shared MenuItemThumb so imagery matches every other surface), then
 * name + spice, price, and a qty stepper / add button. `86` (unavailable)
 * items dim and disable. The dense `line` density stays in the IRD sheet;
 * this card is the touch-grid variant.
 */

import { Minus, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/lib/fnb-api";

import { MenuItemThumb, SpiceIcons, formatINR } from "./menu-visuals";

export function MenuItemCard({
	item,
	qty,
	onAdd,
	onRemove,
	unavailable = false,
}: {
	item: MenuItem;
	qty: number;
	onAdd: () => void;
	onRemove: () => void;
	unavailable?: boolean;
}) {
	return (
		<div
			className={cn(
				"group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors",
				unavailable ? "opacity-50" : "hover:border-brass/40",
			)}
			data-testid={`menu-card-${item.item_code_short}`}
		>
			<div className="relative">
				<MenuItemThumb
					src={item.image}
					category={item.category}
					name={item.item_name}
					vegFlag={item.veg_flag}
					size="grid"
					rounded="rounded-none"
				/>
				<span className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-xs font-medium text-white backdrop-blur">
					{formatINR(item.price)}
				</span>
				{unavailable ? (
					<span className="absolute left-1.5 top-1.5">
						<Badge variant="secondary" className="text-[10px]">86’d</Badge>
					</span>
				) : null}
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
				<div className="flex items-start gap-1.5">
					<span className="line-clamp-2 flex-1 text-sm font-medium leading-snug">{item.item_name}</span>
					<SpiceIcons level={item.spice_level} className="mt-0.5 shrink-0" />
				</div>
				{item.prep_time_minutes ? (
					<span className="text-[11px] text-muted-foreground">~{item.prep_time_minutes} min</span>
				) : null}

				<div className="mt-auto pt-1.5">
					{qty > 0 ? (
						<div className="flex items-center justify-between rounded-lg border p-0.5">
							<Button
								variant="ghost"
								size="icon"
								className="size-7"
								aria-label={`${item.item_name} minus`}
								onClick={onRemove}
								data-testid={`menu-minus-${item.item_code_short}`}
							>
								<Minus className="size-3.5" />
							</Button>
							<span className="text-sm font-medium tabular-nums">{qty}</span>
							<Button
								variant="ghost"
								size="icon"
								className="size-7"
								aria-label={`${item.item_name} plus`}
								onClick={onAdd}
								data-testid={`menu-plus-${item.item_code_short}`}
							>
								<Plus className="size-3.5" />
							</Button>
						</div>
					) : (
						<Button
							variant="outline"
							size="sm"
							className="w-full"
							onClick={onAdd}
							disabled={unavailable}
							aria-label={`Add ${item.item_name}`}
							data-testid={`menu-add-${item.item_code_short}`}
						>
							<Plus className="mr-1 size-3.5" /> Add
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
