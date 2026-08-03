import * as React from "react";
import * as CheckboxPrimitive from "@rn-primitives/checkbox";
import { Check } from "lucide-react-native";

import { cn } from "./lib/cn";

/**
 * `@rn-primitives/checkbox` is the direct port of `@radix-ui/react-checkbox`, so
 * the composition shape matches the web wrapper.
 *
 * One API difference the caller must know about: `rn-primitives` models
 * `checked` as a plain boolean, where the web wrapper accepts
 * `boolean | "indeterminate"`. Nothing in the ops app uses the indeterminate
 * state today (it exists on web for table select-all headers, which have no
 * mobile counterpart), so this is not papered over with a fake tri-state —
 * if a screen ever needs it, it needs a real implementation, not a cast.
 */
const Checkbox = React.forwardRef<
	CheckboxPrimitive.RootRef,
	CheckboxPrimitive.RootProps
>(({ className, ...props }, ref) => (
	<CheckboxPrimitive.Root
		ref={ref}
		className={cn(
			"h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-muted-foreground/50",
			props.checked && "border-primary bg-primary",
			props.disabled && "opacity-50",
			className,
		)}
		{...props}
	>
		<CheckboxPrimitive.Indicator className="items-center justify-center">
			<Check size={16} strokeWidth={3} className="text-primary-foreground" />
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
