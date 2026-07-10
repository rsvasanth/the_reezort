"use client"

import { LogOutIcon, MoreVerticalIcon } from "lucide-react"
import { useFrappeAuth } from "frappe-react-sdk"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavUser({
  user,
}: {
  user: {
    name: string
    role: string
    email: string
    avatar: string
  }
}) {
  const { logout } = useFrappeAuth()

  async function handleLogout() {
    try {
      await logout()
    } finally {
      window.location.reload()
    }
  }

  const initials =
    (user.name || "?").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "RZ"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="user-menu-trigger"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 gap-0.5 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <Badge
                  variant="secondary"
                  data-testid="user-role"
                  className="w-fit px-1.5 py-0 text-[10px] font-normal"
                >
                  {user.role}
                </Badge>
              </div>
              <MoreVerticalIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            // "top": this trigger sits at the very bottom of the sidebar, so
            // any downward/side placement extends past the viewport bottom
            // and the menu is invisible — it must open upward.
            // "start" rather than "end": Carbon's Popover measures this
            // trigger's box via an inline-block wrapper, which collapses to
            // the button's own content width instead of the full-width
            // SidebarMenuButton — "end" alignment then anchors off that
            // wrong (narrower) right edge and renders off-screen. "start"
            // only depends on the (correct) left edge, so it isn't affected.
            side="top"
            align="start"
            sideOffset={4}
            // Carbon's SideNav has overflow:hidden — without the fixed-position
            // escape the menu is clipped at the sidebar's right edge. Safe to
            // combine with side="top": there's always room above, so autoAlign
            // keeps the requested placement instead of flipping.
            avoidClipping
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} data-testid="logout">
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
