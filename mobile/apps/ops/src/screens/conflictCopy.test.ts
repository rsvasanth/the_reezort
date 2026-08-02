import { describe, expect, it } from "vitest";

import type { OutboxRow } from "@reezort/outbox";

import {
	bannerHeadline,
	comparedFields,
	consequence,
	primaryLabel,
	yourOutcome,
} from "./conflictCopy";

const conflicted = (over: Partial<OutboxRow> = {}): OutboxRow => ({
	id: 1,
	clientRequestId: "req-1",
	action: "housekeeping.start_task",
	payload: {},
	targetDoctype: "Housekeeping Task",
	targetName: "RZ-HKT-2026-00042",
	baseModified: "2026-08-02 09:10:00.000000",
	state: "conflict",
	attempts: 1,
	createdAt: Date.parse("2026-08-02T09:13:00.000Z"),
	conflict: {
		reason: "Housekeeping Task was changed after this was queued",
		changedByName: "Anita",
		serverModified: "2026-08-02 09:15:40.221904",
		serverValues: { task_status: "Inspected", assigned_user: "anita@x.com" },
		yourValues: {},
	},
	...over,
});

describe("yourOutcome", () => {
	it("derives the attendant's intent from the action, not the payload", () => {
		// Most housekeeping transitions carry an empty payload — start_task has no
		// fields, only intent. Reading the payload would leave the attendant's
		// column blank against the server's populated one.
		expect(yourOutcome(conflicted())).toBe("In Progress");
		expect(yourOutcome(conflicted({ action: "housekeeping.pause_task" }))).toBe("Paused");
	});

	it("prefers an explicit payload value when the action carries one", () => {
		expect(
			yourOutcome(
				conflicted({ action: "maintenance.transition_ticket", payload: { next_state: "Resolved" } }),
			),
		).toBe("Resolved");
	});
});

describe("bannerHeadline", () => {
	it("names the person who overrode the change", () => {
		expect(bannerHeadline(conflicted(), "Room 214")).toBe("Anita changed Room 214 after you");
	});

	it("never invents an actor the server could not attribute", () => {
		const anonymous = conflicted();
		const row = { ...anonymous, conflict: { ...anonymous.conflict!, changedByName: undefined } };

		expect(bannerHeadline(row, "Room 214")).toBe("Room 214 changed after you");
	});
});

describe("comparedFields", () => {
	it("shows only fields that differ", () => {
		const fields = comparedFields(conflicted());

		expect(fields.map((f) => f.label)).toContain("Status");
		expect(fields.find((f) => f.label === "Status")).toMatchObject({
			mine: "In Progress",
			theirs: "Inspected",
		});
	});
});

describe("consequence", () => {
	it("says nothing is selected before a choice is made", () => {
		expect(consequence(null, conflicted(), "Room 214", 1)).toContain("Nothing is selected yet");
	});

	it("warns that the queued photo dies with the discarded version", () => {
		// The part most likely to be missed: pending_upload is ordered behind its
		// parent write, so keeping the server version destroys the readiness photo.
		expect(consequence("theirs", conflicted(), "Room 214", 1)).toContain("never uploaded");
	});

	it("says the photo uploads when the attendant's version wins", () => {
		expect(consequence("mine", conflicted(), "Room 214", 1)).toContain("photo uploads");
	});

	it("mentions no photo when none is queued", () => {
		expect(consequence("theirs", conflicted(), "Room 214", 0)).not.toMatch(/photo/i);
	});
});

describe("primaryLabel", () => {
	it("never says Confirm — the label restates the outcome", () => {
		// A generic label tests whether the attendant remembers which card they
		// tapped. This is the specific defence against silently picking wrong.
		expect(primaryLabel("mine", conflicted())).toBe("Set to In Progress");
		expect(primaryLabel("theirs", conflicted())).toBe("Keep Inspected");
		expect(primaryLabel("mine", conflicted())).not.toMatch(/confirm/i);
	});

	it("prompts for a choice while nothing is selected", () => {
		expect(primaryLabel(null, conflicted())).toBe("Choose a version");
	});
});
