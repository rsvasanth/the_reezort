/**
 * Shared visual atoms for the restaurant management hub — period-delta pills
 * and the dish trend arrow. Kept in one place so the Sales and Dishes tabs
 * render change indicators identically.
 */

import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DishTrend } from "@/lib/restaurant-management-api";

/** "+8.4%" / "−5%" / "—" (null = no comparable prior period). */
export function fmtSignedPct(n: number | null): string {
	if (n === null || Number.isNaN(n)) return "—";
	const r = Math.round(n * 10) / 10;
	return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`;
}

/**
 * A period-over-period change pill. Green when up, red when down, muted when
 * flat or when there's no comparable prior period (delta === null).
 */
export function DeltaBadge({ value, label }: { value: number | null; label?: string }) {
	const flat = value === null || Math.round(value) === 0;
	const up = (value ?? 0) > 0;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
				flat
					? "bg-muted text-muted-foreground"
					: up
						? "bg-[#24a148]/15 text-[#198038] dark:text-[#6fdc8c]"
						: "bg-destructive/15 text-destructive",
			)}
		>
			{!flat ? up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" /> : null}
			{label ?? fmtSignedPct(value)}
		</span>
	);
}

const TREND_META: Record<DishTrend, { icon: typeof ArrowUpRight; tint: string; label: string }> = {
	up: { icon: ArrowUpRight, tint: "text-[#198038] dark:text-[#6fdc8c]", label: "Up" },
	down: { icon: ArrowDownRight, tint: "text-destructive", label: "Down" },
	flat: { icon: Minus, tint: "text-muted-foreground", label: "Flat" },
	new: { icon: Sparkles, tint: "text-brass", label: "New" },
};

/** The dish velocity trend arrow (qty this window vs the prior one). */
export function TrendArrow({ trend, deltaPct }: { trend: DishTrend; deltaPct: number | null }) {
	const meta = TREND_META[trend];
	const Icon = meta.icon;
	return (
		<span className={cn("inline-flex items-center gap-1 text-xs font-medium tabular-nums", meta.tint)} title={meta.label}>
			<Icon className="size-3.5" />
			{trend === "new" ? "New" : fmtSignedPct(deltaPct)}
		</span>
	);
}
