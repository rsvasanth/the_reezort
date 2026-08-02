/**
 * Token infrastructure and layout primitives ONLY.
 *
 * Deliberately no shared visual components: the ops app is Material 3 consumed
 * from a library, the guest app is the bespoke Reezort brand. A Material button
 * and a luxury-brand button differ in anatomy, not just colour, so sharing them
 * would be false economy (AD-016-008).
 *
 * Guest tokens derive from the existing `#/book` marketing site — never invented.
 */

export interface Spacing {
	readonly xs: number;
	readonly sm: number;
	readonly md: number;
	readonly lg: number;
	readonly xl: number;
}

/** 8pt rhythm, shared by both apps — spacing is not brand expression. */
export const spacing: Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

/** Android minimum touch target (Material accessibility guidance). */
export const MIN_TOUCH_TARGET = 48;
