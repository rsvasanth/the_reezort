import { describe, expect, it } from "vitest";

import { eligibleUploads } from "./uploads";
import type { OutboxRow, PendingUpload } from "./types";

const row = (id: number, state: OutboxRow["state"]): OutboxRow => ({
	id,
	clientRequestId: `req-${id}`,
	action: "housekeeping.complete_task",
	payload: {},
	targetDoctype: "Housekeeping Task",
	targetName: `RZ-HKT-${id}`,
	state,
	attempts: 0,
	createdAt: id,
});

const upload = (id: number, outboxId: number, state: PendingUpload["state"] = "pending"): PendingUpload => ({
	id,
	clientRequestId: `upload-${id}`,
	outboxId,
	localUri: `file:///photos/${id}.jpg`,
	contentHash: `hash-${id}`,
	state,
	attempts: 0,
});

describe("eligibleUploads", () => {
	it("holds a photo until its parent write has landed", () => {
		// attach_mobile_file attaches to the document the write produced. Sending
		// the photo first attaches it to a state the server has not reached, or to
		// nothing at all.
		const uploads = eligibleUploads([row(1, "pending")], [upload(10, 1)]);

		expect(uploads).toEqual([]);
	});

	it("releases a photo once its parent is applied", () => {
		expect(eligibleUploads([row(1, "applied")], [upload(10, 1)]).map((u) => u.id)).toEqual([10]);
	});

	it("holds photos whose parent is awaiting review", () => {
		// The attendant may yet discard this write, and with it the photo. Uploading
		// now would leave an orphan attached to a room whose change was reverted.
		const rows = [row(1, "conflict"), row(2, "refused")];
		const uploads = [upload(10, 1), upload(20, 2)];

		expect(eligibleUploads(rows, uploads)).toEqual([]);
	});

	it("drops photos whose parent row no longer exists", () => {
		// Resolution in favour of the server deletes the row; the repository
		// deletes dependants in the same transaction, but a stale queue must not
		// retry an attachment that can never land.
		expect(eligibleUploads([], [upload(10, 99)])).toEqual([]);
	});

	it("ignores photos already uploaded", () => {
		expect(eligibleUploads([row(1, "applied")], [upload(10, 1, "uploaded")])).toEqual([]);
	});

	it("preserves capture order within a parent", () => {
		const uploads = eligibleUploads(
			[row(1, "applied")],
			[upload(30, 1), upload(10, 1), upload(20, 1)],
		);

		expect(uploads.map((u) => u.id)).toEqual([10, 20, 30]);
	});

	it("orders across parents by the order the work was done", () => {
		const rows = [row(1, "applied"), row(2, "applied")];
		const uploads = [upload(50, 2), upload(10, 1)];

		expect(eligibleUploads(rows, uploads).map((u) => u.id)).toEqual([10, 50]);
	});
});
