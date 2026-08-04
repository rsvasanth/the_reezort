/** A Frappe endpoint answered, but not with success. */
export class FrappeApiError extends Error {
    status;
    serverMessages;
    constructor(message, status, serverMessages) {
        super(message);
        this.status = status;
        this.serverMessages = serverMessages;
        this.name = "FrappeApiError";
    }
}
/** An OAuth endpoint rejected the grant — `invalid_grant`, `invalid_client`, … */
export class AuthError extends Error {
    code;
    status;
    constructor(code, status, description) {
        super(description ? `${code}: ${description}` : code);
        this.code = code;
        this.status = status;
        this.name = "AuthError";
    }
}
/**
 * The device no longer holds a usable session and cannot recover without a new
 * login.
 *
 * Callers must treat this as a wipe trigger, not a retryable error: per
 * AD-016-007 it is indistinguishable from an admin revoking a lost handset, and
 * on a personal phone the cached task list must not survive that.
 */
export class SessionExpiredError extends Error {
    reason;
    constructor(reason) {
        super(`Session expired: ${reason}`);
        this.reason = reason;
        this.name = "SessionExpiredError";
    }
}
