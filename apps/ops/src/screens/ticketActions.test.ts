import { describe, expect, it } from "vitest";

import {
	availableTransitions,
	isTicketClosed,
	SERVER_STATE_TRANSITIONS,
	type TicketTransition,
} from "./ticketActions";

describe("availableTransitions", () => {
	// The point of the module. Every offered transition must be one the server
	// will accept; anything else is a queued write that dies on arrival.
	it("offers nothing the server would refuse", () => {
		for (const state of Object.keys(SERVER_STATE_TRANSITIONS)) {
			const allowed = new Set(SERVER_STATE_TRANSITIONS[state]);
			for (const t of availableTransitions({ state })) {
				expect(
					allowed.has(t.next),
					`${state} → ${t.next} is not in the server's transition map`,
				).toBe(true);
			}
		}
	});

	it("covers every state the server knows about", () => {
		for (const state of Object.keys(SERVER_STATE_TRANSITIONS)) {
			expect(() => availableTransitions({ state })).not.toThrow();
		}
	});

	// Duplicate needs sight of the other ticket, which the handset never pulls.
	it("withholds only Duplicate from what the server allows", () => {
		const offered = new Set<string>(availableTransitions({ state: "Reported" }).map((t) => t.next));
		const serverAllows = SERVER_STATE_TRANSITIONS.Reported ?? [];
		expect(serverAllows.filter((s) => !offered.has(s))).toEqual(["Duplicate"]);
	});

	it("asks for a note exactly where the server files one", () => {
		const wantsNote = (state: string, next: string) =>
			availableTransitions({ state }).find((t) => t.next === next)?.wantsNote;
		expect(wantsNote("In Progress", "Resolved")).toBe(true);
		expect(wantsNote("In Progress", "On Hold")).toBe(true);
		// Closing a resolved ticket adds nothing a note could record.
		expect(wantsNote("Resolved", "Closed")).toBe(false);
		expect(wantsNote("On Hold", "In Progress")).toBe(false);
	});

	it("has one primary action per state that has any", () => {
		for (const state of Object.keys(SERVER_STATE_TRANSITIONS)) {
			const options: readonly TicketTransition[] = availableTransitions({ state });
			if (options.length === 0) continue;
			expect(options.filter((t) => t.primary)).toHaveLength(1);
			expect(options[0]?.primary, `${state}: primary must render first`).toBe(true);
		}
	});

	it("labels the work, not the field value", () => {
		expect(availableTransitions({ state: "On Hold" })[0]?.label).toBe("Resume");
		expect(availableTransitions({ state: "Verification Required" })[0]?.label).toBe(
			"Release the room",
		);
	});
});

describe("isTicketClosed", () => {
	it.each(["Closed", "Duplicate"])("treats %s as a record, not a form", (state) => {
		expect(isTicketClosed({ state })).toBe(true);
	});

	it.each(["Reported", "Assigned", "In Progress", "On Hold", "Resolved"])(
		"keeps %s actionable",
		(state) => {
			expect(isTicketClosed({ state })).toBe(false);
		},
	);

	it("treats a state it has never heard of as closed rather than guessing", () => {
		expect(isTicketClosed({ state: "Escalated To Legal" })).toBe(true);
	});
});
