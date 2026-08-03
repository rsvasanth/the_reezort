const reezortPreset = require("@reezort/tokens/preset");

/** @type {import('tailwindcss').Config} */
module.exports = {
	content: [
		"./App.tsx",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
		"../../packages/ui/src/**/*.{ts,tsx}",
	],
	presets: [require("nativewind/preset"), reezortPreset],
};
