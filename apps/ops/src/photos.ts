/**
 * Room readiness photo capture.
 *
 * AD-016-007 calls the storage rule here "the most important line in this plan",
 * and it is worth restating why: writing a guest-room photograph to the shared
 * media store syncs it into the staff member's personal Google Photos backup.
 * That leak is silent, automatic, and effectively irreversible — the resort
 * cannot reach into someone's private cloud account to undo it.
 *
 * So: capture straight into app-scoped private storage, never `MediaLibrary`,
 * never DCIM, and delete the local copy the moment the upload is confirmed.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { randomUUID } from "expo-crypto";

import type { UploadReader } from "@reezort/outbox";

/** Defaults; overridden per-site from `Mobile Settings`. */
export const PHOTO_MAX_DIMENSION = 1600;
export const PHOTO_JPEG_QUALITY = 0.75;

const PHOTO_DIR = `${FileSystem.documentDirectory}readiness/`;

async function ensureDir(): Promise<void> {
	const info = await FileSystem.getInfoAsync(PHOTO_DIR);
	if (!info.exists) await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
}

export interface CapturedPhoto {
	readonly localUri: string;
	readonly contentHash: string;
	readonly clientRequestId: string;
}

/**
 * Take one readiness photo.
 *
 * Compression is mandatory rather than nice-to-have: staff are on personal data
 * plans (AD-016-007), and a full-resolution capture from a modern handset is
 * several megabytes of someone else's allowance per room.
 */
export async function capturePhoto(options?: {
	maxDimension?: number;
	quality?: number;
}): Promise<CapturedPhoto | null> {
	const permission = await ImagePicker.requestCameraPermissionsAsync();
	if (!permission.granted) return null;

	const shot = await ImagePicker.launchCameraAsync({
		// The single most important flag in the app. `true` would write the
		// original into the shared media store on its way here.
		mediaTypes: ["images"],
		allowsEditing: false,
		quality: 1,
		exif: false,
	});
	if (shot.canceled || !shot.assets[0]) return null;

	const context = ImageManipulator.ImageManipulator.manipulate(shot.assets[0].uri);
	context.resize({ width: options?.maxDimension ?? PHOTO_MAX_DIMENSION });
	const rendered = await context.renderAsync();
	const compressed = await rendered.saveAsync({
		compress: options?.quality ?? PHOTO_JPEG_QUALITY,
		format: ImageManipulator.SaveFormat.JPEG,
	});

	await ensureDir();
	const clientRequestId = randomUUID();
	const localUri = `${PHOTO_DIR}${clientRequestId}.jpg`;
	await FileSystem.moveAsync({ from: compressed.uri, to: localUri });

	const base64 = await FileSystem.readAsStringAsync(localUri, {
		encoding: FileSystem.EncodingType.Base64,
	});

	return {
		localUri,
		// Content hash for the server's dedupe guard — distinct from the
		// per-capture idempotency key, which is what makes the same photograph
		// attachable to two different rooms.
		contentHash: simpleHash(base64),
		clientRequestId,
	};
}

/**
 * FNV-1a over the base64 payload.
 *
 * Only a dedupe hint — the server computes its own SHA-256 and that is what
 * actually guards against duplicate attachments. Hashing megabytes with a real
 * digest on the JS thread would stall the capture screen for no benefit.
 */
function simpleHash(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${hash.toString(16)}-${input.length}`;
}

/** Reads queued photos for the upload worker, and removes them once they land. */
export const photoReader: UploadReader = {
	read: (localUri) =>
		FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 }),

	async discard(localUri) {
		await FileSystem.deleteAsync(localUri, { idempotent: true });
	},
};

/** Logout and remote revoke: no readiness photo outlives the session. */
export async function deleteAllPhotos(): Promise<void> {
	await FileSystem.deleteAsync(PHOTO_DIR, { idempotent: true });
}
