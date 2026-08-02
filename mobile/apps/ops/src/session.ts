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
import { createOutboxRepository, drainOnce } from "@reezort/outbox";

import { expoSqlExecutor } from "./outbox/expoSqlite";
import { secureTokenStore } from "./auth/secureTokenStore";
import { oauthConfig } from "./config";

const DEVICE_ID_KEY = "reezort.ops.device_id";

export const outbox = createOutboxRepository(expoSqlExecutor);

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

export async function pullTasks(): Promise<HousekeepingTask[]> {
	const envelope = await client.call<{
		data: { collections: { housekeeping_tasks?: HousekeepingTask[] } };
	}>("the_reezort.mobile.api.sync_pull", { collections: ["housekeeping_tasks"] });
	return envelope.data.collections.housekeeping_tasks ?? [];
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
