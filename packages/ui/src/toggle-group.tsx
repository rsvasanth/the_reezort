import * as React from "react";
import * as ToggleGroupPrimitive from "@rn-primitives/toggle-group";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";
import { TextClassContext } from "./text";

/** Mirrors the web toggle-group: same variant and size names, 48px targets. */
const toggleVariants = cva("flex-row items-center justify-center gap-2", {
	variants: {
		variant: {
			default: "bg-transparent",
			outline: "border border-border bg-transparent",
		},
		size: {
			default: "h-12 min-w-12 rounded-md px-3",
			sm: "h-10 min-w-10 rounded-md px-2",
			lg: "h-14 min-w-14 rounded-md px-4",
		},
	},
	defaultVariants: { variant: "default", size: "default" },
});

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
	variant: "default",
	size: "default",
});

const ToggleGroup = React.forwardRef<
	ToggleGroupPrimitive.RootRef,
	ToggleGroupPrimitive.RootProps & VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
	<ToggleGroupPrimitive.Root
		ref={ref}
		className={cn("flex-row items-center justify-center gap-1", className)}
		{...props}
	>
		<ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
	</ToggleGroupPrimitive.Root>
));
ToggleGroup.displayName = "ToggleGroup";

const ToggleGroupItem = React.forwardRef<
	ToggleGroupPrimitive.ItemRef,
	ToggleGroupPrimitive.ItemProps & VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, value, ...props }, ref) => {
	const ctx = React.useContext(ToggleGroupContext);
	const { value: selected } = ToggleGroupPrimitive.useRootContext();
	const active = Array.isArray(selected) ? selected.includes(value) : selected === value;

	return (
		<TextClassContext.Provider
			value={cn("text-sm font-medium", active ? "text-primary-foreground" : "text-foreground")}
		>
			<ToggleGroupPrimitive.Item
				ref={ref}
				value={value}
				className={cn(
					toggleVariants({ variant: variant ?? ctx.variant, size: size ?? ctx.size }),
					active && "bg-primary",
					props.disabled && "opacity-50",
					className,
				)}
				{...props}
			>
				{children}
			</ToggleGroupPrimitive.Item>
		</TextClassContext.Provider>
	);
});
ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem, toggleVariants };
