/**
 * The authenticated Frappe client both apps call through.
 *
 * Everything auth-shaped lives behind this seam: screens call `call()` and never
 * see a token, a refresh, or a retry. That is what let AD-016-002 swap the whole
 * authentication mechanism without touching a single screen.
 */
import { AuthError, FrappeApiError, SessionExpiredError } from "./errors";
import { type Fetch, type OAuthConfig, refreshTokens } from "./oauth";
import { type TokenSet, type TokenStore, isExpired } from "./tokens";

export interface FrappeClient {
	call<T>(method: string, body?: unknown): Promise<T>;
}

interface FrappeEnvelope<T> {
	readonly message?: T;
	readonly exception?: string;
	readonly _server_messages?: string;
}

function parseServerMessages(raw: string | undefined): readonly string[] | undefined {
	if (!raw) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : undefined;
	} catch {
		// Frappe occasionally returns a bare string here. Not worth failing over.
		return [raw];
	}
}

export function createClient(
	config: OAuthConfig,
	store: TokenStore,
	doFetch: Fetch,
): FrappeClient {
	/**
	 * The in-flight refresh, shared by every caller that needs one.
	 *
	 * Ten screens resuming from background produce ten simultaneous 401s. Without
	 * this, each starts its own refresh; Frappe issues a new token row per call
	 * and the last write to the store wins, so the device ends up holding a token
	 * the others have already rotated past — and nine surplus `OAuth Bearer Token`
	 * rows are left Active on the server, since rotation revokes nothing.
	 */
	let inFlightRefresh: Promise<TokenSet> | null = null;

	const refreshOnce = (stale: TokenSet): Promise<TokenSet> => {
		if (inFlightRefresh) return inFlightRefresh;

		// Assigned synchronously, before the body reaches its first await, so a
		// concurrent caller cannot slip past the latch.
		inFlightRefresh = (async () => {
			try {
				// The latch only covers callers that overlap. A request that left
				// before someone else's refresh and comes back 401 after it finds the
				// latch already clear — and Frappe accepts the superseded refresh
				// token (no reuse detection), so it would quietly mint a second token
				// and strand an extra Active row on the server. Adopt what the store
				// already holds instead.
				const current = await store.load();
				if (current && current.accessToken !== stale.accessToken) return current;

				const next = await refreshTokens(config, (current ?? stale).refreshToken, doFetch);
				await store.save(next);
				return next;
			} catch (cause) {
				// Only an explicit rejection by the server is terminal: that is
				// indistinguishable from an admin revoking a lost handset, so wipe per
				// AD-016-007.
				//
				// Anything else — no signal, DNS, a secure-store read that failed — is
				// transient and must propagate untouched. Wiping on those would log an
				// attendant out in a service lift and take the unsynced half of their
				// round with it, which for an offline-first app is the one failure
				// mode we cannot ship.
				if (cause instanceof AuthError) {
					await store.clear();
					throw new SessionExpiredError(cause.message);
				}
				throw cause;
			} finally {
				inFlightRefresh = null;
			}
		})();

		return inFlightRefresh;
	};

	const requireTokens = async (): Promise<TokenSet> => {
		const tokens = await store.load();
		if (!tokens) throw new SessionExpiredError("no session on device");

		return isExpired(tokens, Date.now()) ? refreshOnce(tokens) : tokens;
	};

	const send = async (method: string, body: unknown, tokens: TokenSet): Promise<Response> =>
		doFetch(`${config.baseUrl}/api/method/${method}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${tokens.accessToken}`,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			// Frappe stamps `sid=Guest` on every response. Harmless server-side, but
			// on a personal handset nothing of ours belongs in a cookie jar.
			credentials: "omit",
		});

	const call = async <T>(method: string, body?: unknown): Promise<T> => {
		let tokens = await requireTokens();
		let response = await send(method, body, tokens);

		if (response.status === 401) {
			// Exactly one retry. A second 401 means the token is not the problem.
			tokens = await refreshOnce(tokens);
			response = await send(method, body, tokens);

			if (response.status === 401) {
				await store.clear();
				throw new SessionExpiredError("rejected after refresh");
			}
		}

		const payload = (await response.json().catch(() => ({}))) as FrappeEnvelope<T>;

		if (!response.ok) {
			throw new FrappeApiError(
				payload.exception ?? `${method} failed with ${response.status}`,
				response.status,
				parseServerMessages(payload._server_messages),
			);
		}

		return payload.message as T;
	};

	return { call };
}
