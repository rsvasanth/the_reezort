/**
 * Doctype-mirrored types shared by both mobile apps.
 *
 * Every string-literal union here MUST equal its backing doctype Select
 * options exactly. `yarn check:contracts` enforces it. Drift here is what
 * caused the production 417 the guard was written for — a hand-typed value
 * the backend never emits.
 *
 * Populated per screen as Phase 3 lands. Kept empty rather than guessed:
 * a wrong union is worse than a missing one.
 */
export {};
