import { describe, expect, it } from "vitest";

import {
	isUnreachable,
	lastSyncedLabel,
	statusLine,
	syncBadgeCount,
	syncErrorCopy,
	syncRows,
	type SyncState,
} from "./syncStatus";

const summary = (pending = 0, needsReview = 0, failed = 0) => ({ pending, needsReview, failed });

const state = (over: Partial<SyncState> = {}): SyncState => ({
	neverSynced: false,
	syncing: false,
	unreachable: false,
	lastSyncedAt: 1_000_000,
	summary: summary(),
	...over,
});

describe("statusLine", () => {
	it("says nothing more than 'synced' when there is nothing to say", () => {
		expect(statusLine(state())).toBe("synced");
	});

	it("admits it has never synced rather than claiming it has", () => {
		expect(statusLine(state({ neverSynced: true, lastSyncedAt: null }))).toBe("not synced yet");
	});

	// A decision outranks patience: needing review is work for the attendant,
	// queued is work for the network.
	it("ranks needs-review above queued", () => {
		expect(statusLine(state({ summary: summary(3, 2) }))).toBe("2 need review");
		expect(statusLine(state({ summary: summary(3, 0) }))).toBe("3 queued");
	});

	it("ranks offline above both, and keeps the queued count with it", () => {
		expect(statusLine(state({ unreachable: true, summary: summary(3, 2) }))).toBe(
			"offline · 3 queued",
		);
		expect(statusLine(state({ unreachable: true }))).toBe("offline");
	});

	it("ranks an in-flight sync above everything", () => {
		expect(statusLine(state({ syncing: true, unreachable: true, summary: summary(3, 2) }))).toBe(
			"syncing…",
		);
	});

	it("agrees with itself about singular and plural", () => {
		expect(statusLine(state({ summary: summary(0, 1) }))).toBe("1 needs review");
		expect(statusLine(state({ summary: summary(0, 2) }))).toBe("2 need review");
	});
});

describe("syncBadgeCount", () => {
	// A zero badge is noise; its absence carries the same information.
	it("is absent at zero and totals everything otherwise", () => {
		expect(syncBadgeCount(summary())).toBeNull();
		expect(syncBadgeCount(null)).toBeNull();
		expect(syncBadgeCount(summary(1, 2, 3))).toBe(6);
	});
});

describe("lastSyncedLabel", () => {
	const now = 1_000_000_000;

	it("says Never plainly instead of rendering a dash", () => {
		expect(lastSyncedLabel(null, now)).toBe("Never synced");
	});

	it("reads in units a person uses", () => {
		expect(lastSyncedLabel(now - 5_000, now)).toBe("Last synced just now");
		expect(lastSyncedLabel(now - 120_000, now)).toBe("Last synced 2 minutes ago");
		expect(lastSyncedLabel(now - 60_000, now)).toBe("Last synced 1 minute ago");
		expect(lastSyncedLabel(now - 7_200_000, now)).toBe("Last synced 2 hours ago");
		expect(lastSyncedLabel(now - 172_800_000, now)).toBe("Last synced 2 days ago");
	});

	// Device clocks drift; a future timestamp must not render "-3 minutes ago".
	it("does not go negative when the clock is behind", () => {
		expect(lastSyncedLabel(now + 60_000, now)).toBe("Last synced just now");
	});
});

describe("syncRows", () => {
	it("shows only what is non-zero", () => {
		expect(syncRows(summary())).toEqual([]);
		expect(syncRows(summary(3)).map((r) => r.key)).toEqual(["pending"]);
		expect(syncRows(summary(3, 2, 1)).map((r) => r.key)).toEqual([
			"pending",
			"needsReview",
			"failed",
		]);
	});

	it("invites a tap only where there is something to do", () => {
		const rows = syncRows(summary(3, 2, 1));
		expect(rows.find((r) => r.key === "pending")?.navigates).toBe(false);
		expect(rows.find((r) => r.key === "needsReview")?.navigates).toBe(true);
		expect(rows.find((r) => r.key === "failed")?.navigates).toBe(true);
	});

	it("reserves emphasis for the states that need a human", () => {
		const rows = syncRows(summary(3, 2, 1));
		expect(rows.find((r) => r.key === "pending")?.emphasis).toBe(false);
		expect(rows.find((r) => r.key === "needsReview")?.emphasis).toBe(true);
	});
});

describe("isUnreachable", () => {
	it.each([
		"Network request failed",
		"TypeError: Failed to fetch",
		"Request timed out",
		"Unable to resolve host \"app.thereezort.com\"",
	])("reads %s as offline", (message) => {
		expect(isUnreachable(new Error(message))).toBe(true);
	});

	// A refusal is the server talking. Calling that "offline" would tell the
	// attendant to wait for signal they already have.
	it("does not mistake a server refusal for a missing network", () => {
		expect(isUnreachable(new Error("PermissionError: Not permitted"))).toBe(false);
		expect(isUnreachable(new Error("ValidationError: Task is Completed"))).toBe(false);
		expect(isUnreachable("not even an error")).toBe(false);
		expect(isUnreachable(undefined)).toBe(false);
	});
});

describe("syncErrorCopy", () => {
	it("never surfaces the raw exception", () => {
		const copy = syncErrorCopy(new Error("TypeError: Network request failed at fetch()"));
		expect(copy).not.toMatch(/TypeError|fetch\(\)/);
		expect(copy).toMatch(/can't reach the server/i);
	});

	it("reassures that queued work survives, either way", () => {
		expect(syncErrorCopy(new Error("Network request failed"))).toMatch(/saved/i);
		expect(syncErrorCopy(new Error("Internal Server Error"))).toMatch(/saved/i);
	});
});
