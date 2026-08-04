/** A Frappe endpoint answered, but not with success. */
export declare class FrappeApiError extends Error {
    readonly status: number;
    readonly serverMessages?: readonly string[] | undefined;
    constructor(message: string, status: number, serverMessages?: readonly string[] | undefined);
}
/** An OAuth endpoint rejected the grant — `invalid_grant`, `invalid_client`, … */
export declare class AuthError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status: number, description?: string);
}
/**
 * The device no longer holds a usable session and cannot recover without a new
 * login.
 *
 * Callers must treat this as a wipe trigger, not a retryable error: per
 * AD-016-007 it is indistinguishable from an admin revoking a lost handset, and
 * on a personal phone the cached task list must not survive that.
 */
export declare class SessionExpiredError extends Error {
    readonly reason: string;
    constructor(reason: string);
}
