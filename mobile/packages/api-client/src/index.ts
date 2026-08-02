/**
 * Frappe REST client for both mobile apps.
 *
 * Auth is stateless token (`Authorization: token <key>:<secret>`) — NOT session
 * cookies, and NOT OAuth/PKCE, whose support could not be verified against
 * Frappe's docs (see AD-016-002). The Phase 1 spike probes PKCE; if it holds,
 * it replaces the exchange behind this same seam without touching callers.
 */
import type { MobileSession } from "@reezort/domain-types";

export interface ClientConfig {
	readonly baseUrl: string;
	readonly session?: MobileSession;
}

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

export function authHeader(session: MobileSession): Record<string, string> {
	return { Authorization: `token ${session.apiKey}:${session.apiSecret}` };
}

export function createClient(config: ClientConfig) {
	const call = async <T>(method: string, body?: unknown): Promise<T> => {
		const response = await fetch(`${config.baseUrl}/api/method/${method}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(config.session ? authHeader(config.session) : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		const payload = (await response.json().catch(() => ({}))) as {
			message?: T;
			_server_messages?: string;
			exception?: string;
		};

		if (!response.ok) {
			throw new FrappeApiError(
				payload.exception ?? `${method} failed with ${response.status}`,
				response.status,
			);
		}
		return payload.message as T;
	};

	return { call };
}
