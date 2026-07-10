"use client"

import { type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useHashRoute } from "@/hooks/use-hash-route"

export type NavItem = {
  title: string
  url: string
  icon?: LucideIcon
  status?: "live" | "soon"
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

export function NavMain({
  label,
  items,
  className,
}: {
  label?: string
  items: NavItem[]
  className?: string
}) {
  const currentHash = useHashRoute()
  return (
    <SidebarGroup className={className}>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarGroupContent className="flex flex-col gap-1">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              {item.status === "soon" ? (
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
              ) : (
                // No tooltip: the full label is always visible (this sidebar
                // has no icon-only mode), so a native title tooltip just
                // renders a redundant floating box that reads as a glitch.
                <SidebarMenuButton asChild isActive={isItemActive(item.url, currentHash)}>
                  <a href={item.url}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </a>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
