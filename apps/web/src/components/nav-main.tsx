"use client"

import * as React from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { useHashRoute } from "@/hooks/use-hash-route"
import { cn } from "@/lib/utils"

export type NavItem = {
	title: string
	url: string
	icon?: LucideIcon
	status?: "live" | "soon"
}

export type NavCategory = {
	title: string
	icon: LucideIcon
	items: NavItem[]
	/** Index into the categorical ramp — identity, not meaning. See TONE below. */
	tone?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

/**
 * Class names must be static for Tailwind to emit them, so the ramp is a lookup
 * rather than an interpolated `text-cat-${n}`.
 *
 * The hue identifies the section; it never signals state. Active and hover still
 * use the brand, so "where I am" and "what this is" stay separable.
 */
const TONE: Record<number, { icon: string; rest: string; open: string }> = {
	1: { icon: "text-cat-1", rest: "bg-cat-1/[0.07]", open: "data-[state=open]:bg-cat-1/[0.14]" },
	2: { icon: "text-cat-2", rest: "bg-cat-2/[0.07]", open: "data-[state=open]:bg-cat-2/[0.14]" },
	3: { icon: "text-cat-3", rest: "bg-cat-3/[0.07]", open: "data-[state=open]:bg-cat-3/[0.14]" },
	4: { icon: "text-cat-4", rest: "bg-cat-4/[0.07]", open: "data-[state=open]:bg-cat-4/[0.14]" },
	5: { icon: "text-cat-5", rest: "bg-cat-5/[0.07]", open: "data-[state=open]:bg-cat-5/[0.14]" },
	6: { icon: "text-cat-6", rest: "bg-cat-6/[0.07]", open: "data-[state=open]:bg-cat-6/[0.14]" },
	7: { icon: "text-cat-7", rest: "bg-cat-7/[0.07]", open: "data-[state=open]:bg-cat-7/[0.14]" },
	8: { icon: "text-cat-8", rest: "bg-cat-8/[0.07]", open: "data-[state=open]:bg-cat-8/[0.14]" },
}

// Whether a nav item's URL matches the current hash route. Matches the exact
// hash and sub-routes (e.g. "#/analytics" is active on "#/analytics/revenue").
function isItemActive(itemUrl: string, currentHash: string): boolean {
	const hashIndex = itemUrl.indexOf("#")
	if (hashIndex === -1) {
		// Bare /resort-app URL items (none today) — active only on empty hash.
		return !currentHash || currentHash === "#" || currentHash === "#/"
	}
	const itemHash = itemUrl.slice(hashIndex)
	return currentHash === itemHash || currentHash.startsWith(`${itemHash}/`)
}

/** A single leaf row, used both at top level and inside a category. */
function LeafButton({ item, active }: { item: NavItem; active: boolean }) {
	if (item.status === "soon") {
		return (
			<SidebarMenuButton
				tooltip={`${item.title} — coming soon`}
				aria-disabled
				className="cursor-default opacity-60"
			>
				{item.icon && <item.icon />}
				<span>{item.title}</span>
				<Badge variant="outline" className="ml-auto text-[10px] font-normal">
					Soon
				</Badge>
			</SidebarMenuButton>
		)
	}
	return (
		<SidebarMenuButton
			asChild
			isActive={active}
			tooltip={item.title}
			className={cn(
				"hover:bg-sidebar-primary/10",
				"data-[active=true]:bg-sidebar-primary/15 data-[active=true]:text-sidebar-primary",
			)}
		>
			<a href={item.url}>
				{item.icon && <item.icon />}
				<span>{item.title}</span>
			</a>
		</SidebarMenuButton>
	)
}

/**
 * One collapsible category. Starts open when it contains the active route, so a
 * deep link never lands the user on a screen whose nav section is shut.
 *
 * Once opened or closed by hand the manual choice wins, including when the route
 * later changes — reopening a section the user just collapsed reads as the nav
 * fighting them.
 */
function CategoryItem({
	category,
	currentHash,
}: {
	category: NavCategory
	currentHash: string
}) {
	const tone = category.tone ? TONE[category.tone] : undefined
	const containsActive = category.items.some((item) => isItemActive(item.url, currentHash))
	const [open, setOpen] = React.useState(containsActive)
	const touched = React.useRef(false)

	React.useEffect(() => {
		if (!touched.current && containsActive) setOpen(true)
	}, [containsActive])

	return (
		<Collapsible
			asChild
			open={open}
			onOpenChange={(next) => {
				touched.current = true
				setOpen(next)
			}}
			className="group/collapsible"
		>
			<SidebarMenuItem>
				<CollapsibleTrigger asChild>
					<SidebarMenuButton
						tooltip={category.title}
						className={cn(
							tone ? [tone.rest, tone.open] : ["bg-sidebar-accent/40", "data-[state=open]:bg-sidebar-accent/70"],
							"hover:bg-sidebar-primary/10",
						)}
						// Collapsed-with-active-child needs to read as active, since the
						// child rows it would normally show are hidden.
						isActive={!open && containsActive}
					>
						<category.icon className={tone?.icon} />
						<span>{category.title}</span>
						<ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
					</SidebarMenuButton>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<SidebarMenuSub>
						{category.items.map((item) => (
							<SidebarMenuSubItem key={item.title}>
								{item.status === "soon" ? (
									<SidebarMenuSubButton aria-disabled className="cursor-default opacity-60">
										<span>{item.title}</span>
										<Badge variant="outline" className="ml-auto text-[10px] font-normal">
											Soon
										</Badge>
									</SidebarMenuSubButton>
								) : (
									<SidebarMenuSubButton
										asChild
										isActive={isItemActive(item.url, currentHash)}
										className={cn(
											"hover:bg-sidebar-primary/10",
											"data-[active=true]:bg-sidebar-primary/15 data-[active=true]:text-sidebar-primary",
										)}
									>
										<a href={item.url}>
											<span>{item.title}</span>
										</a>
									</SidebarMenuSubButton>
								)}
							</SidebarMenuSubItem>
						))}
					</SidebarMenuSub>
				</CollapsibleContent>
			</SidebarMenuItem>
		</Collapsible>
	)
}

export function NavMain({
	label,
	items = [],
	categories = [],
	className,
}: {
	label?: string
	/** Rendered as flat rows above the categories. */
	items?: NavItem[]
	categories?: NavCategory[]
	className?: string
}) {
	const currentHash = useHashRoute()

	if (items.length === 0 && categories.length === 0) return null

	return (
		<SidebarGroup className={className}>
			{label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
			<SidebarMenu>
				{items.map((item) => (
					<SidebarMenuItem key={item.title}>
						<LeafButton item={item} active={isItemActive(item.url, currentHash)} />
					</SidebarMenuItem>
				))}
				{categories.map((category) => (
					<CategoryItem key={category.title} category={category} currentHash={currentHash} />
				))}
			</SidebarMenu>
		</SidebarGroup>
	)
}
