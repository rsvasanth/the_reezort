/**
 * Restaurant POS formatting helpers — pure, no React. Status → tone maps for
 * the floor plan and KOT screen, plus elapsed-time formatting for tickets.
 */

import type {
	RestaurantOrderItemLineStatus,
	RestaurantOrderState,
	TableLiveStatus,
} from "@/lib/restaurant-api";

export type Tone = {
	/** dot / accent color */
	dot: string;
	/** subtle tinted surface for cards */
	tint: string;
	/** text color on the tint */
	text: string;
	label: string;
};

export function tableTone(status: TableLiveStatus): Tone {
	switch (status) {
		case "Vacant":
			return { dot: "bg-muted-foreground/40", tint: "bg-card", text: "text-muted-foreground", label: "Vacant" };
		case "Seated":
			return { dot: "bg-sky-500", tint: "bg-sky-500/10", text: "text-sky-600 dark:text-sky-300", label: "Seated" };
		case "Preparing":
			return { dot: "bg-brass", tint: "bg-brass/10", text: "text-brass", label: "Preparing" };
		case "Serving":
			return { dot: "bg-emerald-500", tint: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-300", label: "Serving" };
		case "Bill Pending":
			return { dot: "bg-amber-500", tint: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-300", label: "Bill pending" };
		default:
			return { dot: "bg-muted-foreground/40", tint: "bg-card", text: "text-muted-foreground", label: status };
	}
}

export function orderStateTone(state: RestaurantOrderState): Tone {
	switch (state) {
		case "Sent to Kitchen":
			return { dot: "bg-sky-500", tint: "bg-sky-500/10", text: "text-sky-600 dark:text-sky-300", label: "New" };
		case "Preparing":
			return { dot: "bg-brass", tint: "bg-brass/10", text: "text-brass", label: "Preparing" };
		case "Ready":
			return { dot: "bg-emerald-500", tint: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-300", label: "Ready" };
		case "Served":
			return { dot: "bg-muted-foreground", tint: "bg-muted", text: "text-muted-foreground", label: "Served" };
		default:
			return { dot: "bg-muted-foreground/40", tint: "bg-card", text: "text-muted-foreground", label: state };
	}
}

export function lineStatusTone(status: RestaurantOrderItemLineStatus): string {
	switch (status) {
		case "Ready":
			return "text-emerald-600 dark:text-emerald-300";
		case "Preparing":
			return "text-brass";
		case "Served":
			return "text-muted-foreground line-through";
		case "86'd":
			return "text-destructive line-through";
		default:
			return "text-foreground";
	}
}

/** Whole-minutes elapsed since an ISO/Frappe timestamp, or null if unparseable. */
export function minutesSince(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const t = new Date(iso.replace(" ", "T")).getTime();
	if (Number.isNaN(t)) return null;
	return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

export function formatElapsed(iso: string | null | undefined): string {
	const m = minutesSince(iso);
	if (m === null) return "—";
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}
