import type { OutboxRow, PendingUpload, SyncResult } from "./types";
export interface SqlExecutor {
    run(sql: string, params?: readonly unknown[]): Promise<void>;
    all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
    transaction<T>(work: () => Promise<T>): Promise<T>;
}
export interface EnqueueInput {
    readonly clientRequestId: string;
    readonly action: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly targetDoctype?: string;
    readonly targetName?: string;
    readonly baseModified?: string;
    readonly createdAt: number;
}
export interface OutboxSummary {
    readonly pending: number;
    readonly needsReview: number;
    readonly failed: number;
}
export declare function createOutboxRepository(sql: SqlExecutor): {
    init(): Promise<void>;
    enqueue(input: EnqueueInput): Promise<OutboxRow>;
    list(): Promise<OutboxRow[]>;
    get: (id: number) => Promise<OutboxRow | null>;
    /**
     * Claim rows for a send, with a lease.
     *
     * The lease is what lets a crashed drain recover: without it a row marked
     * in_flight and never answered for is skipped by every later pass.
     */
    markInFlight(ids: readonly number[], leaseUntil: number): Promise<void>;
    applyResults(results: readonly SyncResult[], now: number): Promise<void>;
    resolveKeepServer(id: number): Promise<void>;
    resolveKeepMine(id: number, newClientRequestId: () => string): Promise<void>;
    queueUpload(outboxId: number, localUri: string, contentHash: string, clientRequestId: string): Promise<void>;
    /** Every queued photo, for the drain worker to filter. */
    listUploads(): Promise<PendingUpload[]>;
    markUploadState(id: number, state: PendingUpload["state"], bumpAttempts?: boolean): Promise<void>;
    /** Called once the server confirms the attachment. */
    deleteUpload(id: number): Promise<void>;
    uploadsFor(outboxId: number): Promise<PendingUpload[]>;
    summary(): Promise<OutboxSummary>;
    /** BYOD logout and remote revoke: nothing of ours survives on the handset. */
    wipe(): Promise<void>;
};
