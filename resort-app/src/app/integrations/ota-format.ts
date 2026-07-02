/**
 * OTA inbox formatting helpers — pure, no React. State tone map + relative time.
 */

import type { OtaMessageState } from "@/lib/ota-api";

export type Tone = { badge: string; label: string };

export function stateTone(s: OtaMessageState): Tone {
	switch (s) {
		case "New":
			return { badge: "border-transparent bg-brass/15 text-brass", label: "New" };
		case "Converted":
			return { badge: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", label: "Converted" };
		case "Rejected":
			return { badge: "border text-muted-foreground", label: "Rejected" };
		case "Dead-letter":
			return { badge: "border-transparent bg-destructive/15 text-destructive", label: "Dead-letter" };
		default:
			return { badge: "border text-muted-foreground", label: s };
	}
}

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

export function formatDateShort(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(d);
}

export function nights(arrival: string | null, departure: string | null): number | null {
	if (!arrival || !departure) return null;
	const a = new Date(arrival).getTime();
	const d = new Date(departure).getTime();
	if (Number.isNaN(a) || Number.isNaN(d)) return null;
	return Math.max(0, Math.round((d - a) / 86400000));
}
