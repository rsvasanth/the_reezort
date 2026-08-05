import * as React from "react";
import * as TabsPrimitive from "@rn-primitives/tabs";

import { cn } from "./lib/cn";
import { TextClassContext } from "./text";

/**
 * Mirrors the web tabs. Triggers are 48px tall rather than the web's 36 — the
 * same touch-target rule as Button — and the active state is published through
 * TextClassContext because text colour does not cascade in React Native.
 */
const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<TabsPrimitive.ListRef, TabsPrimitive.ListProps>(
	({ className, ...props }, ref) => (
		<TabsPrimitive.List
			ref={ref}
			className={cn("flex-row items-center border-b border-border", className)}
			{...props}
		/>
	),
);
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
	TabsPrimitive.TriggerRef,
	TabsPrimitive.TriggerProps & { value: string }
>(({ className, value, ...props }, ref) => {
	const { value: selected } = TabsPrimitive.useRootContext();
	const active = selected === value;
	return (
		<TextClassContext.Provider
			value={cn("text-sm font-medium", active ? "text-foreground" : "text-muted-foreground")}
		>
			<TabsPrimitive.Trigger
				ref={ref}
				value={value}
				className={cn(
					"h-12 items-center justify-center border-b-2 px-4 -mb-px",
					active ? "border-primary" : "border-transparent",
					props.disabled && "opacity-50",
					className,
				)}
				{...props}
			/>
		</TextClassContext.Provider>
	);
});
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<TabsPrimitive.ContentRef, TabsPrimitive.ContentProps>(
	({ className, ...props }, ref) => (
		<TabsPrimitive.Content ref={ref} className={cn("mt-4", className)} {...props} />
	),
);
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
