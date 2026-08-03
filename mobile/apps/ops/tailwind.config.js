const reezortPreset = require("@reezort/tokens/preset");

/**
 * `content` must include `packages/ui` as well as this app's own sources —
 * Tailwind only emits classes it can see as literal strings, so omitting the
 * shared package would purge every class its components rely on and the UI would
 * render unstyled.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
	content: [
		"./App.tsx",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
		"../../packages/ui/src/**/*.{ts,tsx}",
	],
	presets: [require("nativewind/preset"), reezortPreset],
};
