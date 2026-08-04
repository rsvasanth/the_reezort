/**
 * Token values as JavaScript, for the places NativeWind classes cannot reach:
 * React Navigation's theme, the status bar, the Android system UI background.
 * Everything a component renders should use classes instead — reach for this
 * only at the platform boundary.
 */
/** 8pt rhythm, shared by both apps — spacing is not brand expression. */
export interface Spacing {
    readonly xs: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
}
export declare const spacing: Spacing;
/** Android minimum touch target (Material accessibility guidance). */
export declare const MIN_TOUCH_TARGET = 48;
/** Radius scale in px, matching the rem steps in the Tailwind preset at 16px root. */
export declare const radius: {
    readonly sm: 4;
    readonly md: 8;
    readonly lg: 10;
    readonly xl: 14;
    readonly "2xl": 16;
    readonly "3xl": 24;
};
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
export declare const COLORS: {
    readonly light: Palette;
    readonly dark: Palette;
};
export {};
