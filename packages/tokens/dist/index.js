/*
 * GENERATED — do not hand-edit. Run `yarn workspace @reezort/tokens generate`.
 * Source of truth: packages/tokens/scripts/emit-tokens.ts
 *
 * Accent is Radix's stock `amber`; grays and semantics are derived from the
 * owner's seeds through Radix's own generateRadixColors, so every step carries
 * Radix's contrast guarantees. Foregrounds are computed from WCAG luminance,
 * never assumed white — amber-9 takes dark text.
 *
 * The variable NAMES are the cross-platform contract: `bg-primary` must mean the
 * same colour in a React Native screen as in a DOM one. Do not rename one side
 * without the other.
 */
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
/** Android minimum touch target (Material accessibility guidance). */
export const MIN_TOUCH_TARGET = 48;
/** Radius scale in px, matching the rem steps in the Tailwind preset at 16px root. */
export const radius = { sm: 4, md: 8, lg: 10, xl: 14, "2xl": 16, "3xl": 24 };
export const COLORS = {
    light: {
        background: "hsl(225 100% 98%)",
        foreground: "hsl(230 31% 15%)",
        card: "hsl(225 100% 99%)",
        cardForeground: "hsl(230 31% 15%)",
        primary: "hsl(42 100% 62%)",
        primaryForeground: "hsl(24 40% 22%)",
        muted: "hsl(228 71% 96%)",
        mutedForeground: "hsl(229 17% 43%)",
        accent: "hsl(226 60% 93%)",
        border: "hsl(228 52% 89%)",
        destructive: "hsl(6 63% 46%)",
        success: "hsl(145 45% 34%)",
        warning: "hsl(26 85% 41%)",
        info: "hsl(214 48% 47%)",
        danger: "hsl(6 63% 46%)",
    },
    dark: {
        background: "hsl(240 3% 7%)",
        foreground: "hsl(240 3% 93%)",
        card: "hsl(240 2% 10%)",
        cardForeground: "hsl(240 3% 93%)",
        primary: "hsl(42 100% 62%)",
        primaryForeground: "hsl(36 29% 7%)",
        muted: "hsl(240 1% 14%)",
        mutedForeground: "hsl(240 1% 70%)",
        accent: "hsl(240 1% 16%)",
        border: "hsl(240 2% 23%)",
        destructive: "hsl(6 63% 46%)",
        success: "hsl(141 42% 65%)",
        warning: "hsl(22 96% 70%)",
        info: "hsl(215 92% 75%)",
        danger: "hsl(8 100% 75%)",
    },
};
