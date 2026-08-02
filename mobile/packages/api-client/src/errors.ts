/** A Frappe endpoint answered, but not with success. */
export class FrappeApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly serverMessages?: readonly string[],
	) {
		super(message);
		this.name = "FrappeApiError";
	}
}

/** An OAuth endpoint rejected the grant — `invalid_grant`, `invalid_client`, … */
export class AuthError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		description?: string,
	) {
		super(description ? `${code}: ${description}` : code);
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
	constructor(readonly reason: string) {
		super(`Session expired: ${reason}`);
		this.name = "SessionExpiredError";
	}
}
