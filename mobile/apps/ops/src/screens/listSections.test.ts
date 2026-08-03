import { describe, expect, it } from "vitest";

import {
	rowTitle,
	taskSections,
	tasksEmptyCopy,
	ticketSections,
	ticketsEmptyCopy,
} from "./listSections";

const t = (name: string, task_status: string) => ({ name, task_status, room: "214" });
const k = (name: string, state: string) => ({ name, state, room: "214" });

describe("taskSections", () => {
	it("puts the open task first, then what is left, then what is done", () => {
		const sections = taskSections([
			t("a", "Completed"),
			t("b", "Assigned"),
			t("c", "In Progress"),
		]);
		expect(sections.map((s) => s.title)).toEqual(["In progress", "To do", "Done"]);
		expect(sections[0]?.items.map((i) => i.name)).toEqual(["c"]);
	});

	it("collapses finished work without hiding it", () => {
		const done = taskSections([t("a", "Completed")])[0];
		expect(done?.title).toBe("Done");
		expect(done?.collapsedByDefault).toBe(true);
		expect(done?.items).toHaveLength(1);
	});

	it("drops empty sections rather than rendering empty headings", () => {
		expect(taskSections([t("a", "Assigned")]).map((s) => s.title)).toEqual(["To do"]);
		expect(taskSections([])).toEqual([]);
	});

	// A doctype gaining a status must not make assigned work vanish from the
	// attendant's phone. Surfacing it in the wrong group beats not surfacing it.
	it("surfaces an unrecognised status instead of swallowing the row", () => {
		const sections = taskSections([t("a", "Awaiting Linen")]);
		expect(sections.map((s) => s.title)).toEqual(["To do"]);
		expect(sections[0]?.items.map((i) => i.name)).toEqual(["a"]);
	});

	it("never loses a row across the grouping", () => {
		const rows = [
			t("a", "In Progress"),
			t("b", "Paused"),
			t("c", "Completed"),
			t("d", "Something New"),
		];
		const grouped = taskSections(rows).flatMap((s) => s.items.map((i) => i.name));
		expect(grouped.sort()).toEqual(["a", "b", "c", "d"]);
	});
});

describe("ticketSections", () => {
	it("groups by what the technician does next", () => {
		const sections = ticketSections([
			k("a", "Closed"),
			k("b", "Reported"),
			k("c", "Waiting for Parts"),
		]);
		expect(sections.map((s) => s.title)).toEqual(["In progress", "Open", "Done"]);
		expect(sections[0]?.items.map((i) => i.name)).toEqual(["c"]);
	});

	it("surfaces an unrecognised state under Open", () => {
		expect(ticketSections([k("a", "Escalated")])[0]?.title).toBe("Open");
	});
});

describe("empty copy", () => {
	// Three situations that render identically and mean entirely different things.
	it("distinguishes never-synced from nothing-assigned from all-done", () => {
		expect(tasksEmptyCopy(false, 0, 0)).toBe("Pull down to load your round.");
		expect(tasksEmptyCopy(true, 0, 0)).toBe("Nothing assigned to you yet.");
		expect(tasksEmptyCopy(true, 6, 0)).toBe("Round complete. Nice work.");
	});

	it("says nothing when there is a list to show", () => {
		expect(tasksEmptyCopy(true, 6, 2)).toBe("");
		expect(ticketsEmptyCopy(true, 3)).toBe("");
	});

	it("has its own wording for tickets", () => {
		expect(ticketsEmptyCopy(false, 0)).toBe("Pull down to load your tickets.");
		expect(ticketsEmptyCopy(true, 0)).toBe("No tickets assigned to you.");
	});
});

describe("rowTitle", () => {
	it("leads with the room, because that is what the attendant walks to", () => {
		expect(rowTitle("214", "Departure clean")).toBe("214 · Departure clean");
	});

	it("degrades to the work alone rather than printing a stray separator", () => {
		expect(rowTitle(null, "Departure clean")).toBe("Departure clean");
		expect(rowTitle(undefined, "Departure clean")).toBe("Departure clean");
	});
});
