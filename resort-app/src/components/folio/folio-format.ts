/**
 * Folio formatting helpers — pure functions, no React deps.
 * Kept separate so types stay testable and the components stay tight.
 */

import type {
	BalanceStatus,
	FolioStatus,
	LineStatus,
	PostingStatus,
} from "@/lib/folio-api";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export type StatusBadgeStyle = {
	variant: BadgeVariant;
	/** Optional tailwind className override to layer an accent on top of the variant. */
	className?: string;
};

export function folioStatusBadge(status: FolioStatus): StatusBadgeStyle {
	switch (status) {
		case "Open":
			return { variant: "default" };
		case "Settled":
			return { variant: "default", className: "bg-emerald-600 hover:bg-emerald-600/90" };
		case "Under Review":
		case "Ready for Settlement":
			return { variant: "secondary" };
		case "Cancelled":
			return { variant: "destructive" };
		case "Draft":
		case "Closed":
		case "Transferred":
		default:
			return { variant: "outline" };
	}
}

export function postingStatusBadge(status: PostingStatus): StatusBadgeStyle {
	switch (status) {
		case "Posted":
			return { variant: "default", className: "bg-emerald-600 hover:bg-emerald-600/90" };
		case "Partially Posted":
			return { variant: "secondary" };
		case "Failed":
			return { variant: "destructive" };
		case "Reversed":
			return {
				variant: "outline",
				className: "border-amber-500 text-amber-700 dark:text-amber-300",
			};
		case "Not Posted":
		default:
			return { variant: "outline" };
	}
}

export function balanceStatusBadge(status: BalanceStatus): StatusBadgeStyle {
	switch (status) {
		case "Outstanding":
			return {
				variant: "default",
				className: "bg-amber-500 text-white hover:bg-amber-500/90",
			};
		case "Credit Balance":
			return { variant: "secondary" };
		case "Settled":
			return { variant: "default", className: "bg-emerald-600 hover:bg-emerald-600/90" };
		case "Disputed":
			return { variant: "destructive" };
		case "No Balance":
		default:
			return { variant: "outline" };
	}
}

export function lineStatusBadge(status: LineStatus): StatusBadgeStyle {
	switch (status) {
		case "Posted":
			return { variant: "default", className: "bg-emerald-600 hover:bg-emerald-600/90" };
		case "Open":
			return { variant: "default" };
		case "Routed":
		case "Credited":
		case "Refunded":
			return { variant: "secondary" };
		case "Written Off":
			return {
				variant: "outline",
				className: "border-amber-500 text-amber-700 dark:text-amber-300",
			};
		case "Draft":
		case "Voided":
		case "Transferred":
		default:
			return { variant: "outline" };
	}
}

const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string): Intl.NumberFormat {
	const cached = CURRENCY_FORMATTERS.get(currency);
	if (cached) return cached;
	const formatter = new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency,
		currencyDisplay: "symbol",
		maximumFractionDigits: 2,
		minimumFractionDigits: 2,
	});
	CURRENCY_FORMATTERS.set(currency, formatter);
	return formatter;
}

export function formatCurrency(value: number | null | undefined, currency: string): string {
	if (value === null || value === undefined || Number.isNaN(value)) return "—";
	try {
		return getCurrencyFormatter(currency).format(value);
	} catch {
		return `${value.toFixed(2)} ${currency}`;
	}
}

export function formatServiceDate(iso: string): string {
	// "EEE, d MMM yyyy" — without pulling date-fns.
	const date = new Date(`${iso}T00:00:00`);
	if (Number.isNaN(date.getTime())) return iso;
	const weekday = date.toLocaleDateString("en-IN", { weekday: "short" });
	const day = date.getDate();
	const month = date.toLocaleDateString("en-IN", { month: "short" });
	const year = date.getFullYear();
	return `${weekday}, ${day} ${month} ${year}`;
}

/**
 * Group folio lines first by service_date, then by department-or-source_module.
 * Server may pre-group; this helper is the client-side fallback path.
 */
export function groupLines<L extends { service_date: string; department?: string | null; source_module: string; creation?: string }>(
	lines: L[]
): { date: string; departments: { department: string; lines: L[] }[] }[] {
	const sorted = [...lines].sort((a, b) => {
		if (a.service_date !== b.service_date) {
			return a.service_date < b.service_date ? 1 : -1; // most recent first
		}
		const ac = a.creation ?? "";
		const bc = b.creation ?? "";
		return ac < bc ? -1 : ac > bc ? 1 : 0;
	});

	const byDate = new Map<string, Map<string, L[]>>();
	for (const line of sorted) {
		const dateKey = line.service_date;
		const deptKey = line.department || line.source_module || "Other";
		const dateBucket = byDate.get(dateKey) ?? new Map<string, L[]>();
		const deptBucket = dateBucket.get(deptKey) ?? [];
		deptBucket.push(line);
		dateBucket.set(deptKey, deptBucket);
		byDate.set(dateKey, dateBucket);
	}

	return Array.from(byDate.entries()).map(([date, byDept]) => ({
		date,
		departments: Array.from(byDept.entries()).map(([department, deptLines]) => ({
			department,
			lines: deptLines,
		})),
	}));
}

export type JourneyStep = {
	label: string;
	state: "done" | "current" | "todo";
};

/**
 * Maps folio_status + stay_status onto the linear folio journey
 * (Open → Checked out → Settled → Closed) for the FolioJourney stepper.
 * Cancelled and Transferred don't fit a linear journey — returns null so
 * the caller falls back to a plain status badge.
 */
export function deriveJourney(
	folioStatus: FolioStatus,
	stayStatus?: string | null
): JourneyStep[] | null {
	if (folioStatus === "Cancelled" || folioStatus === "Transferred") return null;

	const closed = folioStatus === "Closed";
	const settled = closed || folioStatus === "Settled";
	const checkedOut = settled || stayStatus === "Checked Out";
	const open = folioStatus !== "Draft";

	const done = [open, checkedOut, settled, closed];
	const labels = ["Open", "Checked out", "Settled", "Closed"];
	// A milestone that hasn't happened must not read as achieved: the current
	// (bold, highlighted) step used to show the milestone's past-tense label —
	// an unsettled folio rendered a bold "Settled", which reads as "this folio
	// is settled" while the rail correctly shows money still owed. Current
	// steps get forward-looking labels instead.
	const currentLabels = ["Open", "In house", "Awaiting settlement", "Awaiting close"];
	const currentIndex = done.indexOf(false);

	return labels.map((label, i) => ({
		label: i === currentIndex ? currentLabels[i] : label,
		state: done[i] ? "done" : i === currentIndex ? "current" : "todo",
	}));
}

/**
 * Spec §6.4: closed/cancelled/settled/transferred folios render read-only
 * with a status-specific banner.
 */
export function readOnlyBannerCopy(status: FolioStatus): string | null {
	switch (status) {
		case "Closed":
			return "This folio is closed. Corrections require a reversal or credit note workflow.";
		case "Cancelled":
			return "This folio was cancelled. No further charges or settlements are allowed.";
		case "Settled":
			return "This folio is settled. Refunds and credit notes are handled via the Finance workspace.";
		case "Transferred":
			return "Charges on this folio were transferred to another folio.";
		default:
			return null;
	}
}
