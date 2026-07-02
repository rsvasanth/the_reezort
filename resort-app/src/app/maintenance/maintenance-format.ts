/**
 * Maintenance formatting helpers — pure, no React. Priority/state tone maps
 * for badges, SLA formatting from minutes_remaining, and relative time.
 */

import type { MaintenancePriority, MaintenanceState } from "@/lib/maintenance-api";

export type Tone = { badge: string; label: string };

export function priorityTone(p: MaintenancePriority): Tone {
	switch (p) {
		case "Urgent":
			return { badge: "border-transparent bg-destructive text-destructive-foreground", label: "Urgent" };
		case "High":
			return { badge: "border-transparent bg-amber-500 text-black", label: "High" };
		case "Normal":
			return { badge: "border-transparent bg-secondary text-secondary-foreground", label: "Normal" };
		case "Low":
		default:
			return { badge: "border text-muted-foreground", label: "Low" };
	}
}

export function stateTone(s: MaintenanceState): Tone {
	switch (s) {
		case "Reported":
			return { badge: "border text-muted-foreground", label: "Reported" };
		case "Assigned":
			return { badge: "border-transparent bg-sky-500/15 text-sky-600 dark:text-sky-300", label: "Assigned" };
		case "In Progress":
			return { badge: "border-transparent bg-brass/15 text-brass", label: "In Progress" };
		case "Resolved":
			return { badge: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", label: "Resolved" };
		case "Closed":
			return { badge: "border text-muted-foreground", label: "Closed" };
		case "Duplicate":
			return { badge: "border text-muted-foreground line-through", label: "Duplicate" };
		default:
			return { badge: "border text-muted-foreground", label: s };
	}
}

/** SLA label from minutes_remaining (negative = overdue). */
export function slaLabel(minutes: number | null): string {
	if (minutes === null) return "—";
	const abs = Math.abs(minutes);
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	const body = h > 0 ? `${h}h ${m}m` : `${m}m`;
	return minutes < 0 ? `${body} overdue` : `${body} left`;
}

/** Coarse relative time from a Frappe timestamp. */
export function relativeTime(iso: string | null | undefined): string {
	if (!iso) return "—";
	const t = new Date(iso.replace(" ", "T")).getTime();
	if (Number.isNaN(t)) return "—";
	const mins = Math.floor((Date.now() - t) / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days === 1) return "yesterday";
	if (days < 7) return `${days}d ago`;
	return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Short room label from a room id like "REEZORT-V4" → "V4". */
export function shortRoom(room: string | null): string {
	if (!room) return "—";
	const parts = room.split("-");
	return parts[parts.length - 1] || room;
}
