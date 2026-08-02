/**
 * Copy and value-derivation for the conflict review screen.
 *
 * Split out because `ui-ux-conflict-review.md` locks the wording, and locked
 * copy that lives inside JSX gets reworded by accident.
 */
import type { OutboxRow } from "@reezort/outbox";

/**
 * What the attendant's queued action would result in.
 *
 * The spec's mockup shows a value on both sides, but most housekeeping
 * transitions carry an empty payload — `start_task` has no fields, only intent.
 * So "yours" is derived from the action rather than read from the payload, or
 * the screen would show the attendant a blank column against the server's
 * populated one and ask them to choose between them.
 */
const OUTCOME: Record<string, string> = {
	"housekeeping.start_task": "In Progress",
	"housekeeping.pause_task": "Paused",
	"housekeeping.complete_task": "Completed",
	"maintenance.transition_ticket": "",
};

export interface FieldPair {
	readonly label: string;
	readonly mine?: string;
	readonly theirs?: string;
}

const LABELS: Record<string, string> = {
	task_status: "Status",
	assigned_user: "Assigned to",
	assigned_to: "Assigned to",
	dnd_status: "DND",
	state: "Status",
	inspection_status: "Status",
	inspector_user: "Inspector",
};

const STATUS_FIELDS = ["task_status", "state", "inspection_status"];

export function yourOutcome(row: OutboxRow): string | undefined {
	const payload = row.payload as Record<string, unknown>;
	const explicit = payload.next_state ?? payload.dnd_status;
	if (typeof explicit === "string") return explicit;
	return OUTCOME[row.action] || undefined;
}

/** Only the fields that differ, plus the status the action would have set. */
export function comparedFields(row: OutboxRow): FieldPair[] {
	const server = (row.conflict?.serverValues ?? {}) as Record<string, unknown>;
	const mineStatus = yourOutcome(row);

	return Object.entries(server)
		.filter(([key]) => key in LABELS)
		.map(([key, value]) => ({
			label: LABELS[key] ?? key,
			theirs: value == null ? undefined : String(value),
			mine: STATUS_FIELDS.includes(key) ? mineStatus : undefined,
		}))
		.filter((pair) => pair.mine !== pair.theirs);
}

export function bannerHeadline(row: OutboxRow, subject: string): string {
	const who = row.conflict?.changedByName;
	// Never invent an actor. When the server could not attribute the change the
	// copy goes impersonal rather than guessing at a colleague's name.
	return who ? `${who} changed ${subject} after you` : `${subject} changed after you`;
}

const time = (value?: string): string => {
	if (!value) return "";
	const match = /(\d{2}):(\d{2})/.exec(value);
	return match ? `${match[1]}:${match[2]}` : "";
};

export function bannerBody(row: OutboxRow, subject: string): string {
	const mine = yourOutcome(row);
	const theirs = row.conflict?.serverValues?.task_status ?? row.conflict?.serverValues?.state;
	const queued = time(new Date(row.createdAt).toISOString());
	const server = time(row.conflict?.serverModified);
	const yours = mine ? `You marked ${subject} ${mine}` : `You changed ${subject}`;
	return `${yours} at ${queued}, offline. It was set to ${theirs ?? "something else"} at ${server}.`;
}

export function consequence(
	choice: "mine" | "theirs" | null,
	row: OutboxRow,
	subject: string,
	photoCount: number,
): string {
	if (!choice) return "Choose which version is right. Nothing is selected yet.";

	const photos =
		photoCount === 0
			? ""
			: choice === "mine"
				? ` Your ${photoCount === 1 ? "photo uploads" : "photos upload"}.`
				: ` Your ${photoCount === 1 ? "photo is" : "photos are"} never uploaded.`;

	if (choice === "mine") {
		return `${subject} goes to ${yourOutcome(row) ?? "your version"}, overwriting the change made after yours.${photos}`;
	}
	const theirs = row.conflict?.serverValues?.task_status ?? row.conflict?.serverValues?.state;
	return `${subject} stays ${theirs ?? "as it is"}. Your change is discarded.${photos}`;
}

export function primaryLabel(choice: "mine" | "theirs" | null, row: OutboxRow): string {
	if (!choice) return "Choose a version";
	if (choice === "mine") return `Set to ${yourOutcome(row) ?? "my version"}`;
	const theirs = row.conflict?.serverValues?.task_status ?? row.conflict?.serverValues?.state;
	return `Keep ${theirs ?? "the server version"}`;
}
