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
		<SidebarMenuButton asChild isActive={active} tooltip={item.title}>
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
						// Collapsed-with-active-child needs to read as active, since the
						// child rows it would normally show are hidden.
						isActive={!open && containsActive}
					>
						<category.icon />
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
									<SidebarMenuSubButton asChild isActive={isItemActive(item.url, currentHash)}>
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
