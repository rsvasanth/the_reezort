/**
 * Grouping and empty-state copy for the two lists.
 *
 * The order is "what do I do next", not the doctype's Select order: a round is a
 * queue of work, and the one task already open belongs at the top of it.
 */
import type { TaskLike } from "./taskActions";
import type { TicketLike } from "./ticketActions";

export interface Section<T> {
	readonly title: string;
	readonly items: readonly T[];
	/** Finished work stays on screen but out of the way. */
	readonly collapsedByDefault: boolean;
}

type TaskRow = TaskLike & { readonly name: string; readonly room?: string | null };

const TASK_BUCKETS: readonly { title: string; statuses: readonly string[]; collapsed: boolean }[] = [
	{ title: "In progress", statuses: ["In Progress"], collapsed: false },
	{
		title: "To do",
		statuses: ["Draft", "Queued", "Assigned", "Paused", "Rework Required"],
		collapsed: false,
	},
	{
		title: "Done",
		statuses: ["Completed", "Inspection Required", "Skipped", "Cancelled"],
		collapsed: true,
	},
];

/**
 * Sections in fixed order, empty ones dropped.
 *
 * A status the doctype gains and this map has not is not silently swallowed: it
 * lands in "To do", where the attendant can still act on it. Dropping the row
 * would hide assigned work, which is the worse failure.
 */
export function taskSections<T extends TaskRow>(tasks: readonly T[]): readonly Section<T>[] {
	const known = new Set(TASK_BUCKETS.flatMap((b) => b.statuses));
	const sections = TASK_BUCKETS.map((bucket) => ({
		title: bucket.title,
		collapsedByDefault: bucket.collapsed,
		items: tasks.filter(
			(t) =>
				bucket.statuses.includes(t.task_status) ||
				(bucket.title === "To do" && !known.has(t.task_status)),
		),
	}));
	return sections.filter((s) => s.items.length > 0);
}

type TicketRow = TicketLike & { readonly name: string; readonly room?: string | null };

const TICKET_BUCKETS: readonly { title: string; statuses: readonly string[]; collapsed: boolean }[] = [
	{ title: "In progress", statuses: ["In Progress", "Waiting for Parts"], collapsed: false },
	{
		title: "Open",
		statuses: ["Reported", "Assigned", "On Hold", "Verification Required"],
		collapsed: false,
	},
	{ title: "Done", statuses: ["Resolved", "Released", "Closed", "Duplicate"], collapsed: true },
];

export function ticketSections<T extends TicketRow>(tickets: readonly T[]): readonly Section<T>[] {
	const known = new Set(TICKET_BUCKETS.flatMap((b) => b.statuses));
	const sections = TICKET_BUCKETS.map((bucket) => ({
		title: bucket.title,
		collapsedByDefault: bucket.collapsed,
		items: tickets.filter(
			(t) =>
				bucket.statuses.includes(t.state) ||
				(bucket.title === "Open" && !known.has(t.state)),
		),
	}));
	return sections.filter((s) => s.items.length > 0);
}

/**
 * Three situations that look identical on screen and mean entirely different
 * things. One generic blank would tell the attendant nothing about which.
 */
export function tasksEmptyCopy(hasEverSynced: boolean, total: number, remaining: number): string {
	if (!hasEverSynced && total === 0) return "Pull down to load your round.";
	if (total === 0) return "Nothing assigned to you yet.";
	if (remaining === 0) return "Round complete. Nice work.";
	return "";
}

export function ticketsEmptyCopy(hasEverSynced: boolean, total: number): string {
	if (!hasEverSynced && total === 0) return "Pull down to load your tickets.";
	if (total === 0) return "No tickets assigned to you.";
	return "";
}

/** `214 · Departure clean` — the room leads, because that is what the attendant walks to. */
export function rowTitle(room: string | null | undefined, kind: string): string {
	return room ? `${room} · ${kind}` : kind;
}
