import * as React from "react";
import * as LabelPrimitive from "@rn-primitives/label";

import { cn } from "./lib/cn";

/**
 * Mirrors the web label. `@rn-primitives/label` wires the accessibility
 * relationship to its control, which is the part worth having a primitive for —
 * on native there is no `htmlFor`, so a hand-rolled label is just styled text
 * that screen readers cannot associate with anything.
 */
const Label = React.forwardRef<LabelPrimitive.TextRef, LabelPrimitive.TextProps>(
	({ className, ...props }, ref) => (
		<LabelPrimitive.Text
			ref={ref}
			className={cn("text-sm font-medium leading-none text-foreground", className)}
			{...props}
		/>
	),
);
Label.displayName = "Label";

export { Label };
