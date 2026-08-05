/**
 * Room condition capture — the first module converted from the web's
 * `lib/*-api.ts` modules to shared hooks, and the reference for the rest.
 *
 * What changed and why it matters:
 *
 * The web version hand-rolled `fetch` with `credentials: "include"` and an
 * `X-Frappe-CSRF-Token` header read from `document.cookie`. That is a browser
 * session, so the module could never leave the web app — which is exactly why
 * mobile faced reimplementing all 37 rather than importing them.
 *
 * `frappe-react-sdk` moves that concern to the provider: cookies on web, Bearer
 * tokens on native, identical call sites. So these hooks carry zero platform
 * assumptions and both apps use them unchanged.
 *
 * PMS endpoints return bare dicts, which Frappe wraps as `{ message: … }`. The
 * SDK does not unwrap that layer, so each hook absorbs it and callers get the
 * typed payload directly — same contract the old module offered.
 */
import {
	useFrappeFileUpload,
	useFrappeGetCall,
	useFrappePostCall,
	useSWRConfig,
} from "frappe-react-sdk";
import { useCallback } from "react";

import type {
	CaptureRoomConditionInput,
	CaptureRoomConditionResult,
	GetRoomConditionCapturesResult,
} from "@reezort/domain-types";

/**
 * Whatever the SDK's uploader accepts, named without reaching for the DOM's
 * `File`. This package compiles with `lib: ["ESNext"]` and no DOM, which is what
 * keeps it importable from React Native — so a hard `File` reference here would
 * not compile, by design. React Native passes `{ uri, name, type }`, which the
 * app casts at its own boundary where the platform is known.
 */
type UploadableFile = Parameters<ReturnType<typeof useFrappeFileUpload>["upload"]>[0];

const GET_CAPTURES = "the_reezort.pms.api.get_room_condition_captures";
const CAPTURE = "the_reezort.pms.api.capture_room_condition";

/** Cache key for a stay's captures, so writes can invalidate the exact read. */
export const roomConditionKey = (stay: string) => `${GET_CAPTURES}:${stay}`;

/**
 * Every condition capture for a stay, oldest first — both Check-In and
 * Check-Out once they exist.
 *
 * Pass a falsy `stay` to skip the request entirely rather than firing one that
 * cannot succeed.
 */
export function useRoomConditionCaptures(stay: string | null | undefined) {
	const { data, error, isLoading, mutate } = useFrappeGetCall<{
		message: GetRoomConditionCapturesResult;
	}>(GET_CAPTURES, stay ? { stay } : undefined, stay ? roomConditionKey(stay) : null);

	return {
		captures: data?.message.captures ?? [],
		error,
		isLoading,
		mutate,
	};
}

/**
 * Records a capture, then invalidates the stay's captures so the list re-syncs
 * from the server.
 *
 * Deliberately does NOT push the response into local state: a write invalidates
 * the cache and lets the normal fetch layer re-read, which keeps one source of
 * truth and is the same path realtime events will use.
 */
export function useCaptureRoomCondition() {
	const { call, loading, error } = useFrappePostCall<{
		message: CaptureRoomConditionResult;
	}>(CAPTURE);
	const { mutate } = useSWRConfig();

	const capture = useCallback(
		async (input: CaptureRoomConditionInput) => {
			const response = await call({
				stay: input.stay,
				capture_stage: input.capture_stage,
				photos: input.photos,
				// Omitted rather than sent as undefined — Frappe treats a present
				// null differently from an absent key on optional fields.
				...(input.overall_condition !== undefined
					? { overall_condition: input.overall_condition }
					: {}),
				...(input.notes !== undefined ? { notes: input.notes } : {}),
			});
			await mutate(roomConditionKey(input.stay));
			return response.message;
		},
		[call, mutate],
	);

	return { capture, isSaving: loading, error };
}

/**
 * Uploads a condition photo and returns its file URL.
 *
 * The web module built multipart FormData by hand and relied on the browser to
 * set the boundary. The SDK owns that, so this works unchanged on React Native
 * where `FormData` and `File` behave differently.
 *
 * `isPrivate` puts the file under /private/files/, served only to an
 * authenticated session — for guest KYC documents. Room-condition photos stay
 * public, which is the default. "Home" is the always-present root folder; a
 * custom one must exist first or Frappe's upload_file throws a 417.
 */
export function useConditionPhotoUpload() {
	const { upload, progress, loading, error, reset } = useFrappeFileUpload<{
		file_url: string;
		name: string;
	}>();

	const uploadPhoto = useCallback(
		async (file: UploadableFile, isPrivate = false) => {
			const result = await upload(file, {
				isPrivate,
				folder: "Home",
			});
			if (!result?.file_url) {
				throw new Error("upload_file returned no file_url");
			}
			return result;
		},
		[upload],
	);

	return { uploadPhoto, progress, isUploading: loading, error, reset };
}
