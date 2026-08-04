/*
 * GENERATED — do not hand-edit. Run `yarn workspace @reezort/tokens generate`.
 * Source of truth: packages/tokens/scripts/emit-tokens.ts
 *
 * Every scale is derived from an owner-supplied seed through Radix's own
 * generateRadixColors, so each step carries Radix's contrast guarantees.
 * Foregrounds are computed from WCAG luminance rather than assumed white — a
 * light accent needs dark text, and nothing in a build would catch it if not.
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
        primary: "hsl(226 70% 55%)",
        primaryForeground: "hsl(0 0% 100%)",
        muted: "hsl(228 71% 96%)",
        mutedForeground: "hsl(229 17% 43%)",
        accent: "hsl(226 60% 93%)",
        border: "hsl(228 52% 89%)",
        destructive: "hsl(6 63% 46%)",
        success: "hsl(145 45% 34%)",
        warning: "hsl(47 100% 29%)",
        info: "hsl(193 83% 31%)",
        danger: "hsl(6 63% 46%)",
    },
    dark: {
        background: "hsl(240 3% 7%)",
        foreground: "hsl(240 3% 93%)",
        card: "hsl(240 2% 10%)",
        cardForeground: "hsl(240 3% 93%)",
        primary: "hsl(226 70% 55%)",
        primaryForeground: "hsl(0 0% 100%)",
        muted: "hsl(240 1% 14%)",
        mutedForeground: "hsl(240 1% 70%)",
        accent: "hsl(240 1% 16%)",
        border: "hsl(240 2% 23%)",
        destructive: "hsl(6 63% 46%)",
        success: "hsl(141 42% 65%)",
        warning: "hsl(47 64% 58%)",
        info: "hsl(195 81% 65%)",
        danger: "hsl(8 100% 75%)",
    },
};
