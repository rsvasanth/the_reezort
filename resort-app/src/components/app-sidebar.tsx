"use client";

import * as React from "react";
import {
	BarChartIcon,
	BedDoubleIcon,
	BookOpenIcon,
	Building2Icon,
	CalendarDaysIcon,
	ClipboardListIcon,
	CreditCardIcon,
	DatabaseIcon,
	HotelIcon,
	SettingsIcon,
	ShieldCheckIcon,
	UsersIcon,
	WrenchIcon,
} from "lucide-react";

import { NavDocuments } from "@/components/nav-documents";
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

const data = {
	user: {
		name: "THE REEZORT",
		email: "Administrator",
		avatar: "",
	},
	navMain: [
		{
			title: "Command center",
			url: "#",
			icon: HotelIcon,
		},
		{
			title: "Property setup",
			url: "#",
			icon: Building2Icon,
		},
		{
			title: "Reservations",
			url: "#",
			icon: CalendarDaysIcon,
		},
		{
			title: "Front office",
			url: "#",
			icon: BedDoubleIcon,
		},
		{
			title: "Finance bridge",
			url: "#",
			icon: CreditCardIcon,
		},
		{
			title: "Analytics",
			url: "#",
			icon: BarChartIcon,
		},
	],
	navSecondary: [
		{
			title: "ERPNext desk",
			url: "/app",
			icon: DatabaseIcon,
		},
		{
			title: "Security",
			url: "#",
			icon: ShieldCheckIcon,
		},
		{
			title: "Settings",
			url: "#",
			icon: SettingsIcon,
		},
	],
	documents: [
		{
			name: "Master specs",
			url: "#",
			icon: BookOpenIcon,
		},
		{
			name: "Sprint tasks",
			url: "#",
			icon: ClipboardListIcon,
		},
		{
			name: "Implementation roles",
			url: "#",
			icon: UsersIcon,
		},
		{
			name: "Engineering backlog",
			url: "#",
			icon: WrenchIcon,
		},
	],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	return (
		<Sidebar collapsible="offcanvas" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
							<a href="/resort-app">
								<HotelIcon className="h-5 w-5" />
								<span className="text-base font-medium tracking-[-0.02em]">THE REEZORT</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={data.navMain} />
				<NavDocuments items={data.documents} />
				<NavSecondary items={data.navSecondary} className="mt-auto" />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={data.user} />
			</SidebarFooter>
		</Sidebar>
	);
}
