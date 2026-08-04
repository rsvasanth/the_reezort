/**
 * The one-line sync state shown in the app bar, and the rows on the Sync screen.
 *
 * The first build put three counters at the top of every screen, reading
 * `0 · 0 · 0` almost always. This replaces them with a single derived state, so
 * the app bar says something only when there is something to say.
 */
import type { OutboxSummary } from "@reezort/outbox";

export interface SyncState {
	/** Nothing has been sent or received yet this install. */
	readonly neverSynced: boolean;
	/** A drain is in flight right now. */
	readonly syncing: boolean;
	/** The last attempt failed to reach the server, as opposed to being refused by it. */
	readonly unreachable: boolean;
	readonly lastSyncedAt: number | null;
	readonly summary: OutboxSummary | null;
}

/**
 * Precedence is deliberate and ordered: a needs-review count outranks a queued
 * count, because one wants a decision and the other wants patience.
 */
export function statusLine(state: SyncState): string {
	if (state.syncing) return "syncing…";

	const queued = state.summary?.pending ?? 0;
	const review = state.summary?.needsReview ?? 0;

	if (state.unreachable) return queued > 0 ? `offline · ${queued} queued` : "offline";
	if (review > 0) return `${review} need${review === 1 ? "s" : ""} review`;
	if (queued > 0) return `${queued} queued`;
	if (state.neverSynced) return "not synced yet";
	return "synced";
}

/** The badge on the Sync tab. Zero returns null — an absent badge says the same thing, quieter. */
export function syncBadgeCount(summary: OutboxSummary | null): number | null {
	if (!summary) return null;
	const total = summary.pending + summary.needsReview + summary.failed;
	return total > 0 ? total : null;
}

/**
 * "Last synced" in words.
 *
 * "Never" is a valid answer and is said plainly — a dash there reads as a
 * rendering bug rather than as information.
 */
export function lastSyncedLabel(lastSyncedAt: number | null, now: number): string {
	if (lastSyncedAt === null) return "Never synced";

	const seconds = Math.max(0, Math.round((now - lastSyncedAt) / 1000));
	if (seconds < 45) return "Last synced just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `Last synced ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `Last synced ${hours} hour${hours === 1 ? "" : "s"} ago`;
	const days = Math.round(hours / 24);
	return `Last synced ${days} day${days === 1 ? "" : "s"} ago`;
}

export interface SyncRow {
	readonly key: "pending" | "needsReview" | "failed";
	readonly label: string;
	/** Rows with nothing to do about them do not invite a tap. */
	readonly navigates: boolean;
	readonly emphasis: boolean;
}

/**
 * Only non-zero rows. A screen of zeroes teaches the attendant that this screen
 * never says anything, and then they stop reading it when it does.
 */
export function syncRows(summary: OutboxSummary | null): readonly SyncRow[] {
	if (!summary) return [];
	const rows: SyncRow[] = [];

	if (summary.pending > 0) {
		rows.push({
			key: "pending",
			label: `${summary.pending} waiting to send`,
			navigates: false,
			emphasis: false,
		});
	}
	if (summary.needsReview > 0) {
		rows.push({
			key: "needsReview",
			label: `${summary.needsReview} need${summary.needsReview === 1 ? "s" : ""} your review`,
			navigates: true,
			emphasis: true,
		});
	}
	if (summary.failed > 0) {
		rows.push({
			key: "failed",
			label: `${summary.failed} couldn't be sent`,
			navigates: true,
			emphasis: true,
		});
	}
	return rows;
}

/**
 * Whether a failed drain means "no network" rather than "the server said no".
 *
 * Deliberately inferred from the failure rather than read from a connectivity
 * API. A transport failure is the only offline signal that changes what the
 * attendant should do, and it needs no permission and no dependency. An app that
 * claims "online" while every request fails is worse than one that says nothing.
 */
export function isUnreachable(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return (
		message.includes("network request failed") ||
		message.includes("failed to fetch") ||
		message.includes("timeout") ||
		message.includes("timed out") ||
		message.includes("unable to resolve host") ||
		message.includes("connection refused")
	);
}

/** One sentence, in the app's words. The raw exception never reaches the attendant. */
export function syncErrorCopy(error: unknown): string {
	if (isUnreachable(error)) return "Can't reach the server. Your work is saved and will sync later.";
	return "Sync didn't finish. Your work is saved — try again in a moment.";
}
