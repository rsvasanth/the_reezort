import * as React from "react";
import { View } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";
import { TextClassContext } from "./text";

/** Mirrors the web badge: default / secondary / destructive / outline. */
const badgeVariants = cva(
	"flex-row items-center self-start rounded-md border px-2.5 py-0.5",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary",
				secondary: "border-transparent bg-secondary",
				destructive: "border-transparent bg-destructive",
				outline: "border-border",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

const badgeTextVariants = cva("text-xs font-semibold", {
	variants: {
		variant: {
			default: "text-primary-foreground",
			secondary: "text-secondary-foreground",
			destructive: "text-destructive-foreground",
			outline: "text-foreground",
		},
	},
	defaultVariants: { variant: "default" },
});

type BadgeProps = React.ComponentPropsWithoutRef<typeof View> &
	VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
	return (
		<TextClassContext.Provider value={badgeTextVariants({ variant })}>
			<View className={cn(badgeVariants({ variant }), className)} {...props} />
		</TextClassContext.Provider>
	);
}

export { Badge, badgeVariants, badgeTextVariants, type BadgeProps };
