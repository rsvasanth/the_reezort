import { describe, expect, it, vi } from "vitest";
import { drainUploads } from "./uploadTransport";
const parent = (over = {}) => ({
    id: 1,
    clientRequestId: "req-1",
    action: "housekeeping.complete_task",
    payload: {},
    targetDoctype: "Housekeeping Task",
    targetName: "RZ-HKT-2026-00042",
    state: "applied",
    attempts: 0,
    createdAt: 0,
    ...over,
});
const queued = (over = {}) => ({
    id: 10,
    clientRequestId: "upload-uuid",
    outboxId: 1,
    localUri: "file:///app/photos/a.jpg",
    contentHash: "hash-a",
    state: "pending",
    attempts: 0,
    ...over,
});
const repo = (rows, uploads) => ({
    list: vi.fn(async () => rows),
    listUploads: vi.fn(async () => uploads),
    markUploadState: vi.fn(async () => { }),
    deleteUpload: vi.fn(async () => { }),
});
const reader = () => ({
    read: vi.fn(async () => "base64-bytes"),
    discard: vi.fn(async () => { }),
});
describe("drainUploads", () => {
    it("attaches to the document the parent write acted on", async () => {
        // The outbox id is local and means nothing to the server; attaching to it
        // would put the photo on the wrong record or on none at all.
        const store = repo([parent()], [queued()]);
        const call = vi.fn(async () => ({ data: { status: "Applied" } }));
        await drainUploads(store, call, reader());
        expect(call).toHaveBeenCalledWith(expect.stringContaining("attach_mobile_file"), expect.objectContaining({
            doctype: "Housekeeping Task",
            name: "RZ-HKT-2026-00042",
            client_request_id: "upload-uuid",
        }));
    });
    it("deletes the on-device copy once the server confirms", async () => {
        // AD-016-007: a guest-room photograph does not linger on a handset the
        // resort does not own.
        const store = repo([parent()], [queued()]);
        const files = reader();
        await drainUploads(store, (async () => ({ data: { status: "Applied" } })), files);
        expect(files.discard).toHaveBeenCalledWith("file:///app/photos/a.jpg");
        expect(store.deleteUpload).toHaveBeenCalledWith(10);
    });
    it("keeps the photo when the upload fails", async () => {
        // The capture moment has passed and this is the only copy. Discarding on
        // failure loses the evidence the room was ready.
        const store = repo([parent()], [queued()]);
        const files = reader();
        const call = vi.fn(async () => {
            throw new Error("network down");
        });
        const outcomes = await drainUploads(store, call, files);
        expect(files.discard).not.toHaveBeenCalled();
        expect(store.deleteUpload).not.toHaveBeenCalled();
        expect(store.markUploadState).toHaveBeenLastCalledWith(10, "pending", true);
        expect(outcomes[0]?.status).toBe("Failed");
    });
    it("treats a server-side Duplicate as done", async () => {
        const store = repo([parent()], [queued()]);
        const files = reader();
        const outcomes = await drainUploads(store, (async () => ({ data: { status: "Duplicate" } })), files);
        expect(outcomes[0]?.status).toBe("Duplicate");
        // Still cleaned up: the server has it, so the local copy is redundant.
        expect(files.discard).toHaveBeenCalled();
    });
    it("does not send a photo whose parent has not landed", async () => {
        const store = repo([parent({ state: "pending" })], [queued()]);
        const call = vi.fn();
        await drainUploads(store, call, reader());
        expect(call).not.toHaveBeenCalled();
    });
});
