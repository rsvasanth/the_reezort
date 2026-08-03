import { describe, expect, it } from "vitest";

import {
	availableTaskActions,
	completionBlockedReason,
	DND_CHOICES,
	dndLabel,
	isBlockedByDnd,
	isReadOnly,
	shouldShowPriority,
} from "./taskActions";

const task = (task_status: string, dnd_status = "None") => ({ task_status, dnd_status });

describe("availableTaskActions", () => {
	it("offers completion as the primary action on an in-progress task", () => {
		const actions = availableTaskActions(task("In Progress"));
		expect(actions.map((a) => a.action)).toEqual(["complete", "pause", "cantAccess"]);
		expect(actions[0]).toMatchObject({ label: "Complete with photo", primary: true });
	});

	// The whole reason this module exists: complete_task throws on a blocking
	// dnd_status, so a button here becomes a failed write hours later, offline.
	it.each(["DND", "Refused", "Access Issue"])(
		"withholds completion when dnd_status is %s",
		(dnd) => {
			const actions = availableTaskActions(task("In Progress", dnd));
			expect(actions.map((a) => a.action)).not.toContain("complete");
			expect(actions.map((a) => a.action)).toEqual(["pause", "cantAccess"]);
		},
	);

	it('treats the doctype\'s "None" as cleared, not as set', () => {
		expect(isBlockedByDnd(task("In Progress", "None"))).toBe(false);
		expect(availableTaskActions(task("In Progress", "None")).map((a) => a.action)).toContain(
			"complete",
		);
	});

	it.each(["Draft", "Queued", "Assigned", "Paused", "Rework Required"])(
		"offers Start from %s",
		(status) => {
			expect(availableTaskActions(task(status)).map((a) => a.action)).toEqual([
				"start",
				"cantAccess",
			]);
		},
	);

	it.each(["Completed", "Cancelled", "Skipped", "Inspection Required"])(
		"offers nothing on %s",
		(status) => {
			expect(availableTaskActions(task(status))).toEqual([]);
			expect(isReadOnly(task(status))).toBe(true);
		},
	);

	it("never returns more than one primary action", () => {
		for (const status of ["In Progress", "Assigned", "Paused", "Draft"]) {
			for (const dnd of ["None", "DND"]) {
				const primaries = availableTaskActions(task(status, dnd)).filter((a) => a.primary);
				expect(primaries.length).toBeLessThanOrEqual(1);
			}
		}
	});

	// A missing button with no explanation reads as a bug to the person holding
	// the phone, so the absence is accounted for in words.
	it("explains a withheld completion and stays silent otherwise", () => {
		expect(completionBlockedReason(task("In Progress", "DND"))).toMatch(/do not disturb/i);
		expect(completionBlockedReason(task("In Progress", "Refused"))).toMatch(/refused/i);
		expect(completionBlockedReason(task("In Progress", "Access Issue"))).toMatch(/access/i);
		expect(completionBlockedReason(task("In Progress"))).toBeNull();
	});
});

describe("row presentation", () => {
	it("shows priority only when it is not the default", () => {
		expect(shouldShowPriority("Normal")).toBe(false);
		expect(shouldShowPriority("High")).toBe(true);
		expect(shouldShowPriority("VIP")).toBe(true);
		expect(shouldShowPriority(null)).toBe(false);
		expect(shouldShowPriority(undefined)).toBe(false);
	});

	it("labels a blocked room and says nothing about a clear one", () => {
		expect(dndLabel("DND")).toBe("Do not disturb");
		expect(dndLabel("Access Issue")).toBe("Access problem");
		expect(dndLabel("None")).toBeNull();
		expect(dndLabel(null)).toBeNull();
	});
});

describe("DND_CHOICES", () => {
	// These values go on the wire as dnd_status; mark_dnd_or_refused throws on
	// anything outside DND_BLOCKING_STATUSES.
	it("sends only values the server accepts", () => {
		expect(DND_CHOICES.map((c) => c.value).sort()).toEqual(["Access Issue", "DND", "Refused"]);
	});

	it("names the attendant's situation, never the field", () => {
		for (const choice of DND_CHOICES) {
			expect(choice.label).not.toMatch(/dnd|status/i);
		}
	});
});
