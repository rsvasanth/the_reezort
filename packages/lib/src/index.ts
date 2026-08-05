/**
 * Shared logic for web and both mobile apps.
 *
 * Rules that keep this package portable, from shared-web-mobile-architecture.md:
 * no `react-dom`, no `react-native`, no direct `fetch` or `document`. Anything
 * platform-specific is injected at the app boundary or handled by the SDK's
 * provider — which is what lets one hook serve a DOM screen and a React Native
 * screen without a branch.
 */
export {
	roomConditionKey,
	useCaptureRoomCondition,
	useConditionPhotoUpload,
	useRoomConditionCaptures,
} from "./hooks/useRoomCondition";
