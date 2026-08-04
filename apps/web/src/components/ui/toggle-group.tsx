import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
	cn(
		"inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors",
		"hover:bg-muted hover:text-muted-foreground",
		"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
		"disabled:pointer-events-none disabled:opacity-50",
		"data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
	),
	{
		variants: {
			variant: {
				default: "bg-transparent",
				outline: "border border-border bg-transparent",
			},
			size: {
				default: "h-9 min-w-9 rounded-md px-3",
				sm: "h-8 min-w-8 rounded-md px-2",
				lg: "h-10 min-w-10 rounded-md px-4",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
)

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
	variant: "default",
	size: "default",
})

const ToggleGroup = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
		VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
	<ToggleGroupPrimitive.Root
		ref={ref}
		className={cn("flex items-center justify-center gap-1", className)}
		{...props}
	>
		<ToggleGroupContext.Provider value={{ variant, size }}>
			{children}
		</ToggleGroupContext.Provider>
	</ToggleGroupPrimitive.Root>
))
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
		VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
	const context = React.useContext(ToggleGroupContext)

	return (
		<ToggleGroupPrimitive.Item
			ref={ref}
			className={cn(
				toggleVariants({
					variant: variant ?? context.variant,
					size: size ?? context.size,
				}),
				className,
			)}
			{...props}
		>
			{children}
		</ToggleGroupPrimitive.Item>
	)
})
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }
