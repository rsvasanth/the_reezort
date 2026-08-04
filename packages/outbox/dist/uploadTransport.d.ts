/**
 * Sending queued photos to `attach_mobile_file`.
 *
 * Reading the file is injected: the package has no filesystem, and on device the
 * bytes come from `expo-file-system`. That also keeps this testable without ever
 * touching a disk.
 */
import type { OutboxRow, PendingUpload } from "./types";
export declare const ATTACH_FILE = "the_reezort.mobile.api.attach_mobile_file";
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
    markUploadState(id: number, state: PendingUpload["state"], bumpAttempts?: boolean): Promise<void>;
    deleteUpload(id: number): Promise<void>;
}
type Call = <T>(method: string, body?: unknown) => Promise<T>;
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
export declare function drainUploads(repo: UploadCapableRepository, call: Call, reader: UploadReader, limit?: number): Promise<UploadOutcome[]>;
export {};
