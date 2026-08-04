import * as React from "react";
import { View } from "react-native";

import { cn } from "./lib/cn";

/**
 * Mirrors the web separator, including its `orientation` prop. Uses a hairline
 * border rather than a 1px height: on high-density Android screens a full pixel
 * reads as a heavy rule, which is why React Native has StyleSheet.hairlineWidth
 * at all. `border-hairline` is not a Tailwind default — the width comes from the
 * explicit style below so it stays density-correct.
 */
type SeparatorProps = React.ComponentPropsWithoutRef<typeof View> & {
	orientation?: "horizontal" | "vertical";
};

const Separator = React.forwardRef<React.ElementRef<typeof View>, SeparatorProps>(
	({ className, orientation = "horizontal", ...props }, ref) => (
		<View
			ref={ref}
			role="separator"
			className={cn(
				"bg-border",
				orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
				className,
			)}
			{...props}
		/>
	),
);
Separator.displayName = "Separator";

export { Separator, type SeparatorProps };
