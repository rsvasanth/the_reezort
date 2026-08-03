/**
 * Token values as JavaScript, for the places NativeWind classes cannot reach.
 *
 * Navigation chrome (React Navigation's theme), the status bar, and the Android
 * system UI background are configured with plain colour strings, not className —
 * so they need the palette in TS. Raven hit the same wall and solved it the same
 * way. Everything a component renders should use classes instead; reach for this
 * only at the platform boundary.
 *
 * Same source and same temporary-location caveat as `global.css` — see its header.
 */

/** 8pt rhythm, shared by both apps — spacing is not brand expression. */
export interface Spacing {
	readonly xs: number;
	readonly sm: number;
	readonly md: number;
	readonly lg: number;
	readonly xl: number;
}

export const spacing: Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

/** Android minimum touch target (Material accessibility guidance). */
export const MIN_TOUCH_TARGET = 48;

/** Radius scale in px, matching the rem steps in the Tailwind preset at 16px root. */
export const radius = { sm: 4, md: 8, lg: 10, xl: 14, "2xl": 16, "3xl": 24 } as const;

interface Palette {
	readonly background: string;
	readonly foreground: string;
	readonly card: string;
	readonly cardForeground: string;
	readonly primary: string;
	readonly primaryForeground: string;
	readonly muted: string;
	readonly mutedForeground: string;
	readonly accent: string;
	readonly border: string;
	readonly destructive: string;
	readonly success: string;
	readonly warning: string;
	readonly info: string;
	readonly danger: string;
}

export const COLORS: { readonly light: Palette; readonly dark: Palette } = {
	light: {
		background: "hsl(39 30% 91%)",
		foreground: "hsl(24 10% 10%)",
		card: "hsl(39 40% 97%)",
		cardForeground: "hsl(24 10% 10%)",
		primary: "hsl(36 36% 52%)",
		primaryForeground: "hsl(39 40% 97%)",
		muted: "hsl(38 23% 88%)",
		mutedForeground: "hsl(24 5% 45%)",
		accent: "hsl(40 19% 81%)",
		border: "hsl(40 19% 81%)",
		destructive: "hsl(6 63% 46%)",
		success: "hsl(95 25% 34%)",
		warning: "hsl(32 55% 45%)",
		info: "hsl(24 5% 45%)",
		danger: "hsl(6 63% 46%)",
	},
	dark: {
		background: "hsl(40 12% 5%)",
		foreground: "hsl(39 30% 91%)",
		card: "hsl(36 11% 8%)",
		cardForeground: "hsl(39 30% 91%)",
		primary: "hsl(36 36% 52%)",
		primaryForeground: "hsl(40 12% 5%)",
		muted: "hsl(40 12% 15%)",
		mutedForeground: "hsl(37 7% 51%)",
		accent: "hsl(40 12% 20%)",
		border: "hsl(40 12% 15%)",
		destructive: "hsl(6 63% 46%)",
		success: "hsl(95 22% 48%)",
		warning: "hsl(32 55% 58%)",
		info: "hsl(37 7% 62%)",
		danger: "hsl(6 63% 52%)",
	},
};
