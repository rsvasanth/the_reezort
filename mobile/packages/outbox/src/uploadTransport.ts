/**
 * Sending queued photos to `attach_mobile_file`.
 *
 * Reading the file is injected: the package has no filesystem, and on device the
 * bytes come from `expo-file-system`. That also keeps this testable without ever
 * touching a disk.
 */
import type { OutboxRow, PendingUpload } from "./types";
import { eligibleUploads } from "./uploads";

export const ATTACH_FILE = "the_reezort.mobile.api.attach_mobile_file";

/** Reads a queued photo as base64, and deletes the local copy once it has landed. */
export interface UploadReader {
	read(localUri: string): Promise<string>;
	/**
	 * Delete the on-device copy.
	 *
	 * AD-016-007: photos are captured to app-scoped private storage and the local
	 * copy goes as soon as the upload is confirmed. On a handset the resort does
	 * not own, a guest-room photograph is not something to leave lying around.
	 */
	discard(localUri: string): Promise<void>;
}

interface UploadCapableRepository {
	list(): Promise<OutboxRow[]>;
	listUploads(): Promise<PendingUpload[]>;
	markUploadState(
		id: number,
		state: PendingUpload["state"],
		bumpAttempts?: boolean,
	): Promise<void>;
	deleteUpload(id: number): Promise<void>;
}

type Call = <T>(method: string, body?: unknown) => Promise<T>;

interface AttachResponse {
	data?: { status?: string; file_url?: string };
}

export interface UploadOutcome {
	readonly uploadId: number;
	readonly status: "Applied" | "Duplicate" | "Failed";
	readonly error?: string;
}

/**
 * One pass over the photo queue.
 *
 * Photos go one at a time on purpose: they are far larger than a sync operation,
 * and on resort Wi-Fi a parallel burst is how you starve the writes that actually
 * matter.
 */
export async function drainUploads(
	repo: UploadCapableRepository,
	call: Call,
	reader: UploadReader,
	limit = 5,
): Promise<UploadOutcome[]> {
	const rows = await repo.list();
	const byId = new Map(rows.map((row) => [row.id, row]));
	const ready = eligibleUploads(rows, await repo.listUploads()).slice(0, limit);
	const outcomes: UploadOutcome[] = [];

	for (const upload of ready) {
		// The attachment target is the document the parent write acted on, not the
		// outbox row — that id is local and means nothing to the server.
		const parent = byId.get(upload.outboxId);
		if (!parent?.targetDoctype || !parent.targetName) {
			await repo.markUploadState(upload.id, "failed");
			outcomes.push({ uploadId: upload.id, status: "Failed", error: "Parent has no target" });
			continue;
		}

		await repo.markUploadState(upload.id, "in_flight");
		try {
			const response = await call<AttachResponse>(ATTACH_FILE, {
				// A per-capture key, not the content hash: the same photograph
				// attached to two different rooms would collide on a hash, and the
				// second attach would return Duplicate and silently never happen.
				client_request_id: upload.clientRequestId,
				doctype: parent.targetDoctype,
				name: parent.targetName,
				filename: `${upload.contentHash}.jpg`,
				content: await reader.read(upload.localUri),
			});

			const status = response?.data?.status === "Duplicate" ? "Duplicate" : "Applied";
			// Confirmed on the server, so the local copy has no reason to exist.
			await reader.discard(upload.localUri);
			await repo.deleteUpload(upload.id);
			outcomes.push({ uploadId: upload.id, status });
		} catch (cause) {
			// Never discard on failure — the photo is the only copy, and the capture
			// moment has passed.
			await repo.markUploadState(upload.id, "pending", true);
			outcomes.push({
				uploadId: upload.id,
				status: "Failed",
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	}

	return outcomes;
}
