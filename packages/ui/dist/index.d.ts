/**
 * The native half of the Reezort design system.
 *
 * This file previously declared that there would deliberately be NO shared
 * visual components, because ops was Material 3 and guest was the bespoke brand
 * (AD-016-008). That premise expired: it rested on the web design system being
 * Carbon, which could not go native. Carbon is gone, the web is on Radix +
 * Tailwind + CVA, and `@rn-primitives` is a direct Radix port — so one system
 * across two renderers is now achievable, and is the owner's decision.
 * AD-016-008 is being rewritten to match.
 *
 * Components are built on `@rn-primitives/*` with NativeWind and
 * `class-variance-authority` — the same primitives/styling/variant triple the
 * web uses, so component and variant names match across platforms (Rule 5).
 * Where a platform forces a difference — touch-target heights, text colour not
 * cascading, React Native's own Switch prop names — the divergence is documented
 * in the component rather than hidden behind a shim.
 *
 * The wrapper discipline carries over from web: screens import from
 * `@reezort/ui`, never from a vendor package directly.
 *
 * Layout tokens are re-exported from `@reezort/tokens` so there is still exactly
 * one source for them — nine screens already import `spacing` from here.
 */
export { cn } from "./lib/cn";
export { Text, TextClassContext, type TextProps } from "./text";
export { Button, buttonVariants, buttonTextVariants, type ButtonProps } from "./button";
export { Badge, badgeVariants, badgeTextVariants, type BadgeProps } from "./badge";
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "./card";
export { Input } from "./input";
export { Separator, type SeparatorProps } from "./separator";
export { Checkbox } from "./checkbox";
export { Switch, type SwitchProps } from "./switch";
export { spacing, MIN_TOUCH_TARGET, radius, COLORS, type Spacing } from "@reezort/tokens";
