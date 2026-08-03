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
import type {
	HousekeepingDndStatus,
	HousekeepingPriority,
	HousekeepingTaskStatus,
	MaintenanceTicketPriority,
	MaintenanceTicketState,
} from "@reezort/domain-types";
import {
	createCacheRepository,
	createOutboxRepository,
	drainOnce,
	drainUploads,
	isTerminal,
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

/**
 * `maintenance_tickets` has been served by `sync_pull`'s PULLABLE tuple since the
 * server module landed; the client simply never asked for it, so the Maintenance
 * role had a working backend and no app.
 *
 * `room_inspections` is deliberately absent: the server does not serve it, and a
 * device cannot display or conflict-check a document it was never sent.
 */
const PULL_COLLECTIONS = ["housekeeping_tasks", "maintenance_tickets", "rooms_summary"] as const;

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

/** `envelope()` in `the_reezort/utils.py`; `ok: false` means the version gate fired. */
export interface SessionEnvelope {
	readonly ok?: boolean;
	readonly data?: {
		readonly user?: { readonly name?: string; readonly full_name?: string };
		readonly roles?: readonly string[];
		readonly drain_only?: boolean;
	};
}

export async function registerSession(appVersion: string): Promise<SessionEnvelope> {
	return client.call<SessionEnvelope>("the_reezort.mobile.api.register_session", {
		device: {
			device_id: await deviceId(),
			app: "Ops",
			platform: "Android",
			app_version: appVersion,
		},
	});
}

const LAST_SYNCED_KEY = "reezort.ops.last_synced_at";

/**
 * Persisted, because "Never synced" after every cold start would be a lie told
 * to someone holding a phone full of cached work.
 */
export async function loadLastSyncedAt(): Promise<number | null> {
	const raw = await SecureStore.getItemAsync(LAST_SYNCED_KEY);
	const parsed = raw ? Number(raw) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : null;
}

export async function saveLastSyncedAt(at: number): Promise<void> {
	await SecureStore.setItemAsync(LAST_SYNCED_KEY, String(at));
}

/**
 * Document names with a write still on the device.
 *
 * Drives the one-word "queued" marker on a row. The screens never see outbox
 * rows themselves — the outbox is machinery, and only the Sync screen shows it.
 */
export async function queuedTargetNames(): Promise<Set<string>> {
	const rows = await outbox.list();
	return new Set(
		rows.filter((r) => !isTerminal(r.state) && r.targetName).map((r) => r.targetName as string),
	);
}

/**
 * Fields as `_collection_query` in `the_reezort/mobile/services/sync.py` sends
 * them — not as 005's data-model names them. `dnd_status` is carried because the
 * client mirrors the server's completion guard with it.
 */
export interface HousekeepingTask {
	readonly name: string;
	readonly room: string;
	readonly task_type: string;
	readonly task_status: HousekeepingTaskStatus;
	readonly priority: HousekeepingPriority;
	readonly dnd_status?: HousekeepingDndStatus;
	readonly due_at?: string | null;
	readonly modified: string;
}

/** Maintenance Ticket ships `state`/`assigned_to`, not 009's `ticket_status`. */
export interface MaintenanceTicket {
	readonly name: string;
	readonly room: string;
	readonly state: MaintenanceTicketState;
	readonly priority: MaintenanceTicketPriority;
	readonly modified: string;
}

/** The cached list. Works with no signal, which is the whole point. */
export async function cachedTasks(): Promise<HousekeepingTask[]> {
	return cache.list<HousekeepingTask>("housekeeping_tasks");
}

export async function cachedTickets(): Promise<MaintenanceTicket[]> {
	return cache.list<MaintenanceTicket>("maintenance_tickets");
}

/**
 * Refresh the cache from the server, then read back from it.
 *
 * Incremental: stored watermarks go up as `since`, held ids go up as `known`,
 * and tombstones evict work reassigned away. A task that leaves the attendant
 * would otherwise sit on the handset indefinitely.
 */
export async function refreshTasks(): Promise<HousekeepingTask[]> {
	await pullAll();
	return cachedTasks();
}

/** One pull serves both lists; the collections travel in the same request. */
export async function pullAll(): Promise<void> {
	const now = Date.now();
	await syncPullOnce(cache, client.call.bind(client), [...PULL_COLLECTIONS], now);
	await cache.purgeOlderThan(now - WORKING_WINDOW_MS);
}

export async function cachedBoth(): Promise<{
	tasks: HousekeepingTask[];
	tickets: MaintenanceTicket[];
}> {
	return { tasks: await cachedTasks(), tickets: await cachedTickets() };
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

/**
 * Record why a room could not be serviced.
 *
 * `mark_dnd_or_refused` pauses the task and sets the guard that then blocks
 * completion, so this is not a note — it changes what the attendant is offered
 * next, which is why it is queued as a write rather than kept on the device.
 */
export async function queueDndOrRefused(
	task: HousekeepingTask,
	dndStatus: "DND" | "Refused" | "Access Issue",
	notes?: string,
): Promise<void> {
	await outbox.enqueue({
		clientRequestId: randomUUID(),
		action: "housekeeping.mark_dnd_or_refused",
		payload: notes ? { dnd_status: dndStatus, notes } : { dnd_status: dndStatus },
		targetDoctype: "Housekeeping Task",
		targetName: task.name,
		baseModified: task.modified,
		createdAt: Date.now(),
	});
}

/**
 * Step a maintenance ticket.
 *
 * The caller is responsible for offering only transitions the server allows —
 * see `screens/ticketActions.ts`. The server re-checks regardless; this keeps the
 * refusal from happening hours later, offline, where nobody can act on it.
 */
export async function queueTicketTransition(
	ticket: MaintenanceTicket,
	nextState: string,
	notes?: string,
): Promise<void> {
	await outbox.enqueue({
		clientRequestId: randomUUID(),
		action: "maintenance.transition_ticket",
		payload: notes ? { next_state: nextState, notes } : { next_state: nextState },
		targetDoctype: "Maintenance Ticket",
		targetName: ticket.name,
		baseModified: ticket.modified,
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
