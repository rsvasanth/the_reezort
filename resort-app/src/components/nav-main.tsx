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

export type NavItem = {
  title: string
  url: string
  icon?: LucideIcon
  status?: "live" | "soon"
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
                <SidebarMenuButton asChild tooltip={item.title}>
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
