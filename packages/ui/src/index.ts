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
export {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
} from "./dialog";
export { Checkbox } from "./checkbox";
export { Switch, type SwitchProps } from "./switch";
export { Label } from "./label";
export { Textarea } from "./textarea";
export { Skeleton } from "./skeleton";
export { Avatar, AvatarImage, AvatarFallback } from "./avatar";
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./collapsible";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
export { ToggleGroup, ToggleGroupItem, toggleVariants } from "./toggle-group";
export {
	Select,
	SelectGroup,
	SelectValue,
	SelectTrigger,
	SelectContent,
	SelectLabel,
	SelectItem,
	SelectSeparator,
} from "./select";
export { Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription } from "./sheet";
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./table";

/**
 * Deliberately NOT ported, with reasons — so the next person does not read the
 * gap as unfinished work:
 *
 * - `breadcrumb`  Native navigation is a stack with a back affordance. A
 *                 breadcrumb trail restates what the header and back button
 *                 already say.
 * - `tooltip`     Requires hover. On touch there is no equivalent that is not a
 *                 long-press easter egg, so the label belongs on screen instead.
 * - `sidebar`     Belongs to navigation, not the component library — expo-router
 *                 owns drawers, and the ops shell already has a tab bar.
 * - `dropdown-menu` Reaches native as an action sheet, which is a Sheet with a
 *                 list. Adding a second overlay primitive for it would duplicate
 *                 Sheet without adding behaviour.
 * - `chart`       Needs a React Native charting library, which is a dependency
 *                 decision rather than a wrapper. Blocks the analytics surfaces
 *                 only, which are late in the surface map.
 * - `sonner`      Already implemented as the toast in the ops shell. It becomes a
 *                 shared component when a second app needs it.
 */

export { spacing, MIN_TOUCH_TARGET, radius, COLORS, type Spacing } from "@reezort/tokens";
