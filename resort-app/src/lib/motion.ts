/**
 * Shared motion presets — subtle, premium, consistent.
 * Wrap the app in <MotionConfig reducedMotion="user"> so these respect the OS
 * "reduce motion" setting automatically.
 */

import type { Variants, Transition } from "motion/react";

// easeOutExpo — quick, settled, never bouncy for page chrome.
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const SPRING: Transition = { type: "spring", stiffness: 400, damping: 30 };

/** Whole-screen entrance: fade + small rise. */
export const pageEnter: Variants = {
	hidden: { opacity: 0, y: 8 },
	show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } },
};

/** Container that staggers its children in. */
export const staggerContainer: Variants = {
	hidden: {},
	show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

/** A staggered child (KPI tile, list row, card). */
export const staggerItem: Variants = {
	hidden: { opacity: 0, y: 10 },
	show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } },
};

/** Plain fade-in. */
export const fadeIn: Variants = {
	hidden: { opacity: 0 },
	show: { opacity: 1, transition: { duration: 0.3, ease: EASE_OUT } },
};
