/**
 * Maintenance ticket transitions, mirrored from the server state machine.
 *
 * `STATE_TRANSITIONS` in `the_reezort/maintenance/api.py` is the truth;
 * `transition_ticket` throws on anything outside it. This module exists so the
 * mirror lives in exactly one place with one test, rather than as a scatter of
 * button conditions that drift independently.
 */
import type { MaintenanceTicketState } from "@reezort/domain-types";

export interface TicketLike {
	readonly state: MaintenanceTicketState | string;
}

export interface TicketTransition {
	/** Sent as `next_state`. Must be in the server's allowed set for the current state. */
	readonly next: MaintenanceTicketState;
	/** What the technician is doing, not what the field becomes. */
	readonly label: string;
	readonly primary: boolean;
	/** Resolution notes are filed by the server; ask before queueing. */
	readonly wantsNote: boolean;
}

/**
 * Exactly `STATE_TRANSITIONS`, minus the transitions a phone must not make.
 *
 * `Duplicate` is absent by choice: marking a ticket a duplicate needs sight of
 * the other ticket, which the handset does not pull. It is a web-SPA action.
 */
const TRANSITIONS: Record<string, readonly TicketTransition[]> = {
	Reported: [
		{ next: "In Progress", label: "Start work", primary: true, wantsNote: false },
		{ next: "Assigned", label: "Assign to me", primary: false, wantsNote: false },
	],
	Assigned: [
		{ next: "In Progress", label: "Start work", primary: true, wantsNote: false },
		{ next: "Resolved", label: "Resolve", primary: false, wantsNote: true },
		{ next: "On Hold", label: "Put on hold", primary: false, wantsNote: true },
	],
	"In Progress": [
		{ next: "Resolved", label: "Resolve", primary: true, wantsNote: true },
		{ next: "Waiting for Parts", label: "Waiting for parts", primary: false, wantsNote: true },
		{ next: "On Hold", label: "Put on hold", primary: false, wantsNote: true },
	],
	"Waiting for Parts": [
		{ next: "In Progress", label: "Resume", primary: true, wantsNote: false },
		{ next: "On Hold", label: "Put on hold", primary: false, wantsNote: true },
	],
	"On Hold": [{ next: "In Progress", label: "Resume", primary: true, wantsNote: false }],
	Resolved: [
		{ next: "Closed", label: "Close", primary: true, wantsNote: false },
		{ next: "Verification Required", label: "Send for verification", primary: false, wantsNote: false },
	],
	"Verification Required": [
		{ next: "Released", label: "Release the room", primary: true, wantsNote: false },
	],
	Released: [{ next: "Closed", label: "Close", primary: true, wantsNote: false }],
	Closed: [],
	Duplicate: [],
};

export function availableTransitions(ticket: TicketLike): readonly TicketTransition[] {
	return TRANSITIONS[ticket.state] ?? [];
}

/** True when the ticket is finished and the screen is a record, not a form. */
export function isTicketClosed(ticket: TicketLike): boolean {
	return availableTransitions(ticket).length === 0;
}

/**
 * The exact server map, exported for the test that proves this mirror has not
 * drifted. Kept beside the mirror so the two are edited in the same diff.
 */
export const SERVER_STATE_TRANSITIONS: Record<string, readonly string[]> = {
	Reported: ["Assigned", "In Progress", "Duplicate"],
	Assigned: ["In Progress", "On Hold", "Resolved"],
	"In Progress": ["Resolved", "On Hold", "Waiting for Parts"],
	"Waiting for Parts": ["In Progress", "On Hold"],
	"On Hold": ["In Progress"],
	Resolved: ["Closed", "Verification Required"],
	"Verification Required": ["Released"],
	Released: ["Closed"],
	Closed: [],
	Duplicate: [],
};
