/**
 * Shared F&B menu visuals — the single source of truth for how a menu item
 * looks anywhere in the restaurant module (IRD sheet, POS grid, table detail,
 * KOT, QR menu). Extracted from ird-order-sheet.tsx so every surface renders
 * item imagery, veg dots, and spice level identically — zero drift.
 *
 * Design intent (7-star bar): an item image is never a broken square. We show
 * the real photo when it loads; on missing/failed src we fall back to a
 * category-tinted gradient tile with the item's initial. A veg dot always
 * overlays so dietary info survives even the fallback.
 */

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";

import { cn } from "@/lib/utils";

export function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: "INR",
		maximumFractionDigits: 0,
	}).format(n);
}

export function parseTags(s: string | null | undefined): string[] {
	if (!s) return [];
	return s.split(",").map((t) => t.trim()).filter(Boolean);
}

const VEG_FLAG_COLOR: Record<string, string> = {
	"Non-veg": "bg-[#fa4d56]",
	Egg: "bg-[#b28600]",
	Vegan: "bg-[#198038]",
	Veg: "bg-[#24a148]",
};

export function VegDot({ flag, className }: { flag: string; className?: string }) {
	const color = VEG_FLAG_COLOR[flag] ?? "bg-[#24a148]";
	return (
		<span
			className={cn("inline-block size-2.5 rounded-full ring-1 ring-black/20", color, className)}
			aria-label={flag}
			title={flag}
		/>
	);
}

export function SpiceIcons({ level, className }: { level: number | null; className?: string }) {
	if (!level || level <= 0) return null;
	return (
		<span className={cn("inline-flex", className)} aria-label={`Spice ${level}/3`}>
			{Array.from({ length: Math.min(level, 3) }).map((_, i) => (
				<Flame key={i} className="size-3 text-[#fa4d56]" />
			))}
		</span>
	);
}

/** Category → gradient for the fallback tile (matches the seeded PIL tiles). */
const CATEGORY_GRADIENT: Record<string, string> = {
	Starters: "from-orange-500 to-orange-900",
	Mains: "from-rose-500 to-rose-950",
	Desserts: "from-pink-400 to-fuchsia-900",
	Beverages: "from-teal-500 to-slate-900",
	Alcohol: "from-indigo-500 to-purple-950",
	Sides: "from-amber-500 to-amber-900",
	Breakfast: "from-yellow-500 to-orange-900",
	Other: "from-lime-500 to-slate-900",
};

export function categoryGradient(category: string): string {
	return CATEGORY_GRADIENT[category] ?? "from-stone-500 to-stone-900";
}

type ThumbSize = "sm" | "md" | "lg" | "grid";

const THUMB_SIZE: Record<ThumbSize, string> = {
	sm: "size-11", // dense lists
	md: "size-14", // IRD line rows
	lg: "size-20", // table detail
	grid: "aspect-[4/3] w-full", // POS grid tile (image on top)
};

const INITIAL_TEXT: Record<ThumbSize, string> = {
	sm: "text-base",
	md: "text-lg",
	lg: "text-2xl",
	grid: "text-3xl",
};

/**
 * The item image atom. Renders the photo with lazy loading and object-cover;
 * on missing or broken src it degrades to a branded gradient tile with the
 * item initial. `size="grid"` fills its column at a 4:3 ratio for the POS
 * card; the other sizes are fixed squares for list rows.
 */
export function MenuItemThumb({
	src,
	category,
	name,
	vegFlag,
	size = "md",
	rounded = "rounded-md",
	showVegDot = true,
	className,
}: {
	src: string | null;
	category: string;
	name: string;
	vegFlag?: string;
	size?: ThumbSize;
	rounded?: string;
	showVegDot?: boolean;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);

	// A new src (e.g. list re-fetch) gets a fresh chance to load.
	useEffect(() => {
		setFailed(false);
	}, [src]);

	const initial = name.trim().slice(0, 1).toUpperCase() || "•";
	const showImage = !!src && !failed;

	return (
		<div
			className={cn(
				"relative shrink-0 overflow-hidden bg-muted ring-1 ring-black/10",
				THUMB_SIZE[size],
				rounded,
				className,
			)}
		>
			{showImage ? (
				<img
					src={src as string}
					alt={name}
					loading="lazy"
					onError={() => setFailed(true)}
					className="h-full w-full object-cover"
				/>
			) : (
				<div
					className={cn(
						"flex h-full w-full items-center justify-center bg-gradient-to-br",
						categoryGradient(category),
					)}
				>
					<span className={cn("font-serif text-white/90", INITIAL_TEXT[size])}>{initial}</span>
				</div>
			)}
			{showVegDot && vegFlag ? (
				<span className="pointer-events-none absolute bottom-1 left-1">
					<VegDot flag={vegFlag} className="ring-black/30" />
				</span>
			) : null}
		</div>
	);
}
