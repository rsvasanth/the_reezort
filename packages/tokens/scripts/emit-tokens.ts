/**
 * The single source of the Reezort palette. Run `yarn workspace @reezort/tokens generate`.
 *
 * Writes three files from one computation, so web and native cannot drift:
 *   apps/web/src/index.css        CSS custom properties for Tailwind
 *   packages/tokens/global.css    the same properties for NativeWind (no --sidebar-*)
 *   packages/tokens/src/index.ts  a TS object, for the platform boundaries where
 *                                 NativeWind classes cannot reach (nav chrome,
 *                                 status bar, Android system UI)
 *
 * Accent, grays and semantics are all derived from owner-supplied seeds through
 * Radix's own generateRadixColors, so every step carries Radix's contrast
 * guarantees. The accent briefly used Radix's published `amber` scale; the owner
 * reverted to this custom bronze, which is darker and more restrained.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


import { generateRadixColors } from "./generate-radix-colors.tsx";

const ACCENT = "#A66407";
const GRAY = { light: "#0A0D1E", dark: "#E5E5E6" };
const BG = { light: "#FFFFFF", dark: "#111111" };

/**
 * `warning` is pulled yellow, away from the bronze accent. Roughly 87 utilities
 * across the screens resolve to `warning`; at the accent's own hue those screens
 * would flatten into a single colour.
 */
const SEEDS = { success: "#2F7D4F", warning: "#C2A000", danger: "#C0392B", info: "#3E6FB0" };

const hexToHsl = (hex: string) => {
	let h = hex.replace("#", "");
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const r = parseInt(h.slice(0, 2), 16) / 255;
	const g = parseInt(h.slice(2, 4), 16) / 255;
	const b = parseInt(h.slice(4, 6), 16) / 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
	const L = (max + min) / 2;
	const S = d === 0 ? 0 : d / (1 - Math.abs(2 * L - 1));
	let H = 0;
	if (d !== 0) {
		if (max === r) H = 60 * (((g - b) / d) % 6);
		else if (max === g) H = 60 * ((b - r) / d + 2);
		else H = 60 * ((r - g) / d + 4);
	}
	if (H < 0) H += 360;
	return `${Math.round(H)} ${Math.round(S * 100)}% ${Math.round(L * 100)}%`;
};

/** WCAG relative luminance. */
const lum = (hex: string) => {
	let h = hex.replace("#", "");
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const ch = [0, 2, 4].map((i) => {
		const c = parseInt(h.substr(i, 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};

/**
 * Foreground for a solid step, chosen by contrast rather than assumed white.
 *
 * Not a nicety. When the accent was briefly Radix's amber, step 9 (#ffc53d) gave
 * white text 1.58:1 — far below the 4.5:1 floor. Radix documents amber, yellow,
 * lime, mint and sky as scales whose step 9 takes dark text. Hardcoding white
 * would make every primary button unreadable, and no build step would catch it.
 */
const fgFor = (bg: string, scale: string[]) => {
	const L = lum(bg);
	const white = 1.05 / (L + 0.05);
	const dark = scale[11];
	const cDark = (L + 0.05) / (lum(dark) + 0.05);
	if (white >= 4.5 && white > cDark) return "0 0% 100%";
	return hexToHsl(cDark >= 4.5 ? dark : scale[0]);
};

type Mode = "light" | "dark";

function build(mode: Mode) {
	const scales: Record<string, string[]> = {};
	for (const [name, seed] of Object.entries({ accent: ACCENT, ...SEEDS })) {
		const r = generateRadixColors({
			appearance: mode,
			accent: seed,
			gray: GRAY[mode],
			background: BG[mode],
		});
		scales[name] = r.accentScale;
		if (!scales.gray) scales.gray = r.grayScale;
	}
	const s = (n: string, i: number) => hexToHsl(scales[n][i - 1]);
	const fg = (n: string, i: number) => fgFor(scales[n][i - 1], scales[n]);
	const L = mode === "light";

	/** Shared with native. */
	const core: Record<string, string> = {
		background: L ? s("gray", 2) : s("gray", 1),
		foreground: s("gray", 12),
		card: L ? s("gray", 1) : s("gray", 2),
		"card-foreground": s("gray", 12),
		popover: L ? s("gray", 1) : s("gray", 2),
		"popover-foreground": s("gray", 12),
		primary: s("accent", 9),
		"primary-foreground": fg("accent", 9),
		secondary: s("gray", 3),
		"secondary-foreground": s("gray", 12),
		muted: s("gray", 3),
		"muted-foreground": s("gray", 11),
		accent: s("gray", 4),
		"accent-foreground": s("gray", 12),
		destructive: s("danger", 9),
		"destructive-foreground": fg("danger", 9),
		border: s("gray", 6),
		input: s("gray", 7),
		ring: s("accent", 8),
		brass: s("accent", 9),
		"brass-foreground": fg("accent", 9),
		success: s("success", L ? 9 : 11),
		"success-foreground": fg("success", L ? 9 : 11),
		warning: s("warning", 11),
		"warning-foreground": fg("warning", 11),
		info: s("info", L ? 9 : 11),
		"info-foreground": fg("info", L ? 9 : 11),
		danger: s("danger", L ? 9 : 11),
		"danger-foreground": fg("danger", L ? 9 : 11),
		"chart-1": s("accent", 9),
		"chart-2": s("info", 9),
		"chart-3": s("success", 9),
		"chart-4": s("danger", 9),
		"chart-5": s("gray", 9),
		/**
		 * Low accent steps, exposed for the ambient wash behind the app shell —
		 * the same treatment radix-ui.com uses at the top of its own pages
		 * (`linear-gradient(to bottom, var(--accent-4), transparent)`). Step 3/4
		 * are Radix's "component background" steps: tinted enough to read as
		 * brand, flat enough to put text on. Derived, not picked by eye, so the
		 * wash follows whatever the accent becomes.
		 */
		"brand-wash": s("accent", 4),
		"brand-wash-soft": s("accent", 3),
	};

	/** Web shell only — no native counterpart. */
	const sidebar: Record<string, string> = {
		"sidebar-background": L ? s("gray", 2) : s("gray", 1),
		"sidebar-foreground": s("gray", 11),
		"sidebar-primary": s("accent", 9),
		"sidebar-primary-foreground": fg("accent", 9),
		"sidebar-accent": s("gray", 4),
		"sidebar-accent-foreground": s("gray", 12),
		"sidebar-border": s("gray", 6),
		"sidebar-ring": s("accent", 8),
	};

	return { core, sidebar };
}

const light = build("light");
const dark = build("dark");

const RADII = `
\t\t/* Distinct steps: large surfaces, controls and pills must not collapse to one value. */
\t\t--radius-sm: 0.25rem;
\t\t--radius-md: 0.5rem;
\t\t--radius-lg: 0.625rem;
\t\t--radius-xl: 0.875rem;
\t\t--radius-2xl: 1rem;
\t\t--radius-3xl: 1.5rem;
\t\t--radius: 0.625rem;`;

const decls = (m: Record<string, string>) =>
	Object.entries(m).map(([k, v]) => `\t\t--${k}: ${v};`).join("\n");

const GENERATED = `/*
 * GENERATED — do not hand-edit. Run \`yarn workspace @reezort/tokens generate\`.
 * Source of truth: packages/tokens/scripts/emit-tokens.ts
 *
 * Every scale is derived from an owner-supplied seed through Radix's own
 * generateRadixColors, so each step carries Radix's contrast guarantees.
 * Foregrounds are computed from WCAG luminance rather than assumed white — a
 * light accent needs dark text, and nothing in a build would catch it if not.
 *
 * The variable NAMES are the cross-platform contract: \`bg-primary\` must mean the
 * same colour in a React Native screen as in a DOM one. Do not rename one side
 * without the other.
 */`;

// ── 1. Web ───────────────────────────────────────────────────────────────────
const webCss = `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap");

@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * \`font-display\` is the body sans, deliberately.
 *
 * It is applied to only 10 of 50 screens, and to six sets of tabular figures.
 * That went unnoticed for months because under Carbon it resolved to IBM Plex
 * Sans — the same family as body text — so it was a visual no-op and its
 * placement never meant anything. Pointing a real display face at it made the
 * inconsistency visible rather than creating it. Until a display face is
 * actually chosen, one consistent face beats a serif on an arbitrary tenth of
 * the app.
 */
@layer utilities {
\t.font-display {
\t\tfont-family: "Inter", ui-sans-serif, system-ui, sans-serif;
\t}
}

${GENERATED}
@layer base {
\t:root {
${decls({ ...light.core, ...light.sidebar })}
${RADII}
\t}

\t* {
\t\t@apply border-border;
\t}

\tbody {
\t\t@apply bg-background text-foreground antialiased;
\t\tfont-family:
\t\t\t"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
\t\t\tsans-serif;
\t}

\t.light {
${decls({ ...light.core, ...light.sidebar })}
\t}

\t.dark {
${decls({ ...dark.core, ...dark.sidebar })}
\t}
}
`;

// ── 2. Native CSS (NativeWind) ───────────────────────────────────────────────
const nativeCss = `${GENERATED}
/* \`--sidebar-*\` is deliberately absent: a web-shell concept with no native counterpart. */

@layer base {
\t:root {
${decls(light.core)}
\t}

\t.dark:root {
${decls(dark.core)}
\t}
}
`;

// ── 3. Native TS ─────────────────────────────────────────────────────────────
const TS_KEYS: [string, string][] = [
	["background", "background"], ["foreground", "foreground"],
	["card", "card"], ["card-foreground", "cardForeground"],
	["primary", "primary"], ["primary-foreground", "primaryForeground"],
	["muted", "muted"], ["muted-foreground", "mutedForeground"],
	["accent", "accent"], ["border", "border"],
	["destructive", "destructive"], ["success", "success"],
	["warning", "warning"], ["info", "info"], ["danger", "danger"],
];

const palette = (m: Record<string, string>) =>
	TS_KEYS.map(([k, js]) => `\t\t${js}: "hsl(${m[k]})",`).join("\n");

const nativeTs = `${GENERATED}

/**
 * Token values as JavaScript, for the places NativeWind classes cannot reach:
 * React Navigation's theme, the status bar, the Android system UI background.
 * Everything a component renders should use classes instead — reach for this
 * only at the platform boundary.
 */

/** 8pt rhythm, shared by both apps — spacing is not brand expression. */
export interface Spacing {
\treadonly xs: number;
\treadonly sm: number;
\treadonly md: number;
\treadonly lg: number;
\treadonly xl: number;
}

export const spacing: Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

/** Android minimum touch target (Material accessibility guidance). */
export const MIN_TOUCH_TARGET = 48;

/** Radius scale in px, matching the rem steps in the Tailwind preset at 16px root. */
export const radius = { sm: 4, md: 8, lg: 10, xl: 14, "2xl": 16, "3xl": 24 } as const;

interface Palette {
${TS_KEYS.map(([, js]) => `\treadonly ${js}: string;`).join("\n")}
}

export const COLORS: { readonly light: Palette; readonly dark: Palette } = {
\tlight: {
${palette(light.core)}
\t},
\tdark: {
${palette(dark.core)}
\t},
};
`;

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

for (const [file, content] of [
	[path.join(repo, "apps/web/src/index.css"), webCss],
	[path.join(repo, "packages/tokens/global.css"), nativeCss],
	[path.join(repo, "packages/tokens/src/index.ts"), nativeTs],
] as [string, string][]) {
	writeFileSync(file, content);
	console.log(`  wrote ${path.relative(repo, file)}`);
}
console.log(`\n  accent  ${light.core.primary}  fg ${light.core["primary-foreground"]}`);
console.log(`  warning ${light.core.warning}   danger ${light.core.danger}`);
