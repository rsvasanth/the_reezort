/**
 * Which actions a housekeeping task offers, and what they are called.
 *
 * Rule and label live together on purpose. `ui-ux-ops-app.md` locks both, and
 * they fail as a pair: an action offered under the wrong condition and an action
 * labelled for the wrong outcome are the same defect from the attendant's side.
 *
 * This module mirrors server guards. Where it does, the server file is named —
 * a mirror with no pointer back is a mirror nobody updates.
 */
import type {
	HousekeepingDndStatus,
	HousekeepingPriority,
	HousekeepingTaskStatus,
} from "@reezort/domain-types";

export interface TaskLike {
	readonly task_status: HousekeepingTaskStatus | string;
	readonly dnd_status?: HousekeepingDndStatus | string | null;
	readonly priority?: HousekeepingPriority | string | null;
}

export type TaskAction = "start" | "pause" | "complete" | "cantAccess";

export interface ActionOption {
	readonly action: TaskAction;
	readonly label: string;
	/** Rendered as the filled button. At most one per screen. */
	readonly primary: boolean;
}

/**
 * `DND_BLOCKING_STATUSES` in `the_reezort/housekeeping/api.py`.
 *
 * "None" is the doctype's cleared value, so absence of a blocking reason is not
 * the same as an empty field.
 */
const BLOCKING_DND = new Set(["DND", "Refused", "Access Issue"]);

/** Work is over; the attendant has nothing left to do to this task. */
const TERMINAL = new Set(["Completed", "Cancelled", "Skipped"]);

/** Done and handed on. Acting here would reopen someone else's step. */
const AWAITING_OTHERS = new Set(["Inspection Required"]);

export function isBlockedByDnd(task: TaskLike): boolean {
	return BLOCKING_DND.has(task.dnd_status ?? "");
}

export function isReadOnly(task: TaskLike): boolean {
	return TERMINAL.has(task.task_status) || AWAITING_OTHERS.has(task.task_status);
}

/**
 * The actions to render, in render order, primary first.
 *
 * Nothing is returned-and-disabled. A disabled button still reads as "this is
 * available to me, later" and invites tapping; the spec asks for the action to be
 * absent instead.
 */
export function availableTaskActions(task: TaskLike): readonly ActionOption[] {
	if (isReadOnly(task)) return [];

	if (task.task_status === "In Progress") {
		const options: ActionOption[] = [];
		// `complete_task` throws when dnd_status is blocking. Offering it anyway
		// queues a write that fails hours later, offline, for a reason the
		// attendant cannot act on — so the client refuses first, in person.
		if (!isBlockedByDnd(task)) {
			options.push({ action: "complete", label: "Complete with photo", primary: true });
		}
		options.push({ action: "pause", label: "Pause", primary: false });
		options.push({ action: "cantAccess", label: "Can't access the room", primary: false });
		return options;
	}

	return [
		{ action: "start", label: "Start", primary: true },
		{ action: "cantAccess", label: "Can't access the room", primary: false },
	];
}

/**
 * Why `Complete` is missing, for the one case where its absence would otherwise
 * look like a bug to the person holding the phone.
 */
export function completionBlockedReason(task: TaskLike): string | null {
	if (!isBlockedByDnd(task)) return null;
	if (task.dnd_status === "DND") return "Marked do not disturb. A supervisor can clear it.";
	if (task.dnd_status === "Refused") return "Entry was refused. A supervisor can clear it.";
	return "There's an access problem on this room. A supervisor can clear it.";
}

/** Shown on a row only when it carries weight — a chip on every row hides the urgent ones. */
export function shouldShowPriority(priority: string | null | undefined): boolean {
	return !!priority && priority !== "Normal";
}

const DND_LABELS: Record<string, string> = {
	DND: "Do not disturb",
	Refused: "Entry refused",
	"Access Issue": "Access problem",
};

/** The reason, in the attendant's words, or null when nothing blocks the room. */
export function dndLabel(dnd: string | null | undefined): string | null {
	return DND_LABELS[dnd ?? ""] ?? null;
}

export interface DndChoice {
	/** Sent as `dnd_status`; must be a value the doctype's Select allows. */
	readonly value: "DND" | "Refused" | "Access Issue";
	readonly label: string;
}

/** Named as the attendant's situation, not as the field they are setting. */
export const DND_CHOICES: readonly DndChoice[] = [
	{ value: "DND", label: "Guest asked not to be disturbed" },
	{ value: "Refused", label: "Guest refused entry" },
	{ value: "Access Issue", label: "Door or key problem" },
];
