import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

/**
 * Replaces a 175-line Carbon adapter that reconstructed this compound API by
 * walking the child tree — collecting TabsList/TabsTrigger/TabsContent markers,
 * mapping them onto Carbon's index-based selection, then rebuilding the tree in
 * place. All of that existed because Carbon's Tabs is index-driven and requires
 * TabList/TabPanels as direct children. Radix is value-driven and composes
 * freely, so the nesting cases the adapter had to special-case (a TabsList
 * nested inside a flex row in data-table.tsx) just work.
 */
const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.List
		ref={ref}
		className={cn(
			"inline-flex items-center justify-center gap-1 border-b border-border",
			className,
		)}
		{...props}
	/>
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		className={cn(
			"inline-flex items-center justify-center whitespace-nowrap border-b-2 border-transparent",
			"px-4 py-2 text-sm font-medium text-muted-foreground transition-colors -mb-px",
			"hover:text-foreground",
			"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
			"disabled:pointer-events-none disabled:opacity-50",
			"data-[state=active]:border-primary data-[state=active]:text-foreground",
			className,
		)}
		{...props}
	/>
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		className={cn(
			"mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			className,
		)}
		{...props}
	/>
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
