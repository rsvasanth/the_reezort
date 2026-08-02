/**
 * The app's wiring: one client, one outbox, one device identity.
 *
 * Kept out of the screens so `App.tsx` stays about rendering, and so the pieces
 * that need each other (client -> rotate_session, outbox -> client) are joined
 * in exactly one place.
 */
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";

import { createClient, type FrappeClient } from "@reezort/api-client";
import {
	createCacheRepository,
	createOutboxRepository,
	drainOnce,
	drainUploads,
	syncPullOnce,
} from "@reezort/outbox";

import { expoSqlExecutor } from "./outbox/expoSqlite";
import { capturePhoto, photoReader } from "./photos";
import { secureTokenStore } from "./auth/secureTokenStore";
import { oauthConfig } from "./config";

const DEVICE_ID_KEY = "reezort.ops.device_id";

export const outbox = createOutboxRepository(expoSqlExecutor);
export const cache = createCacheRepository(expoSqlExecutor);

/**
 * How far back the device keeps cached work.
 *
 * AD-016-007 asks for cached documents outside the working window to be purged
 * on each successful sync — on a handset the resort does not own, holding less
 * is a security control, not a storage tweak. Two shifts covers a round that
 * spans midnight without keeping last week's rooms.
 */
const WORKING_WINDOW_MS = 36 * 60 * 60 * 1000;

const PULL_COLLECTIONS = ["housekeeping_tasks", "rooms_summary"] as const;

/**
 * A stable per-install id, in secure storage.
 *
 * `Mobile Device` is keyed on it, so a value that changed per launch would
 * orphan a device row on every cold start and make remote revoke meaningless.
 */
export async function deviceId(): Promise<string> {
	const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
	if (existing) return existing;
	const fresh = randomUUID();
	await SecureStore.setItemAsync(DEVICE_ID_KEY, fresh);
	return fresh;
}

export const client: FrappeClient = createClient(oauthConfig, secureTokenStore, fetch, {
	// Frappe revokes nothing on refresh, so without this the handset accumulates
	// live credentials. It is best-effort by design — the client swallows a
	// failure here rather than losing the request that triggered the refresh.
	onRefreshed: async () => {
		await client.call("the_reezort.mobile.api.rotate_session", {
			device_id: await deviceId(),
		});
	},
});

export async function registerSession(appVersion: string) {
	return client.call<{ ok?: boolean }>("the_reezort.mobile.api.register_session", {
		device: {
			device_id: await deviceId(),
			app: "Ops",
			platform: "Android",
			app_version: appVersion,
		},
	});
}

export interface HousekeepingTask {
	readonly name: string;
	readonly room: string;
	readonly task_type: string;
	readonly task_status: string;
	readonly priority: string;
	readonly modified: string;
}

/** The cached list. Works with no signal, which is the whole point. */
export async function cachedTasks(): Promise<HousekeepingTask[]> {
	return cache.list<HousekeepingTask>("housekeeping_tasks");
}

/**
 * Refresh the cache from the server, then read back from it.
 *
 * Incremental: stored watermarks go up as `since`, held ids go up as `known`,
 * and tombstones evict work reassigned away. A task that leaves the attendant
 * would otherwise sit on the handset indefinitely.
 */
export async function refreshTasks(): Promise<HousekeepingTask[]> {
	const now = Date.now();
	await syncPullOnce(cache, client.call.bind(client), [...PULL_COLLECTIONS], now);
	await cache.purgeOlderThan(now - WORKING_WINDOW_MS);
	return cachedTasks();
}

/**
 * Queue a task transition. Confirmed to the attendant immediately; the network
 * is the sync worker's problem, not theirs.
 */
export async function queueTransition(
	task: HousekeepingTask,
	action: "start_task" | "pause_task" | "complete_task",
): Promise<void> {
	await outbox.enqueue({
		clientRequestId: randomUUID(),
		action: `housekeeping.${action}`,
		payload: {},
		targetDoctype: "Housekeeping Task",
		targetName: task.name,
		// The version the attendant was looking at. The server rejects rather than
		// clobbers if it has moved since.
		baseModified: task.modified,
		createdAt: Date.now(),
	});
}

export async function drain() {
	return drainOnce(outbox, client.call.bind(client), Date.now());
}

/**
 * Queue a completion with its readiness photo.
 *
 * The photo is enqueued behind the write, so the upload worker cannot attach it
 * before the document reaches the state it documents.
 */
export async function queueCompletionWithPhoto(task: HousekeepingTask): Promise<boolean> {
	const photo = await capturePhoto();
	if (!photo) return false;

	const row = await outbox.enqueue({
		clientRequestId: randomUUID(),
		action: "housekeeping.complete_task",
		payload: {},
		targetDoctype: "Housekeeping Task",
		targetName: task.name,
		baseModified: task.modified,
		createdAt: Date.now(),
	});
	await outbox.queueUpload(row.id, photo.localUri, photo.contentHash, photo.clientRequestId);
	return true;
}

/** Drain writes first, then the photos those writes made attachable. */
export async function drainAll() {
	const writes = await drainOnce(outbox, client.call.bind(client), Date.now());
	const photos = await drainUploads(outbox, client.call.bind(client), photoReader);
	return { writes, photos };
}
