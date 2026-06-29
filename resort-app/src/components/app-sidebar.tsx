"use client";

import * as React from "react";
import {
	DatabaseIcon,
	HotelIcon,
	LayoutDashboardIcon,
	ReceiptTextIcon,
} from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";

import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

const navMain = [
	{ title: "Executive cockpit", url: "/resort-app", icon: LayoutDashboardIcon },
	{ title: "Vikram Menon · Suite", url: "/resort-app#/folio/RZ-FOL-2026-00001", icon: ReceiptTextIcon },
	{ title: "Anjali Rao · Deluxe", url: "/resort-app#/folio/RZ-FOL-2026-00002", icon: ReceiptTextIcon },
	{ title: "Rahul Kapoor · Villa", url: "/resort-app#/folio/RZ-FOL-2026-00003", icon: ReceiptTextIcon },
];

const navSecondary = [{ title: "ERPNext desk", url: "/app", icon: DatabaseIcon }];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { currentUser } = useFrappeAuth();
	const user = {
		name: currentUser ?? "Resort staff",
		email: currentUser ? "Signed in" : "",
		avatar: "",
	};

	return (
		<Sidebar collapsible="offcanvas" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
							<a href="/resort-app">
								<HotelIcon className="h-5 w-5" />
								<span className="text-base font-medium">THE REEZORT</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={navMain} />
				<NavSecondary items={navSecondary} className="mt-auto" />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
		</Sidebar>
	);
}
