"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
	BarChartIcon,
	BedDoubleIcon,
	ClockIcon,
	BellIcon,
	CalendarDaysIcon,
	DatabaseIcon,
	HeartHandshakeIcon,
	HotelIcon,
	LifeBuoyIcon,
	LayoutDashboardIcon,
	ListChecksIcon,
	ClipboardListIcon,
	PartyPopperIcon,
	PlugIcon,
	ReceiptTextIcon,
	ShieldCheckIcon,
	SparklesIcon,
	UsersIcon,
	UtensilsIcon,
	WrenchIcon,
} from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";

import { NavMain, type NavItem } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { allowedSidebarTitles, canAccessDesk, useUserProfile } from "@/hooks/use-user-profile";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

// Operational modules — Live = built and working, Soon = on the roadmap.
const operations: NavItem[] = [
	{ title: "Executive cockpit", url: "/resort-app", icon: LayoutDashboardIcon, status: "live" },
	{ title: "Reservations", url: "/resort-app#/reservations", icon: CalendarDaysIcon, status: "live" },
	{ title: "Front desk", url: "/resort-app#/frontdesk", icon: BedDoubleIcon, status: "live" },
	{ title: "Housekeeping", url: "/resort-app#/housekeeping", icon: SparklesIcon, status: "live" },
	{ title: "My tasks", url: "/resort-app#/my-tasks", icon: ListChecksIcon, status: "live" },
	{ title: "All tasks", url: "/resort-app#/tasks", icon: ClipboardListIcon, status: "live" },
	{ title: "Billing", url: "/resort-app#/billing", icon: ReceiptTextIcon, status: "live" },
	{ title: "Restaurant & bar", url: "/resort-app#/restaurant", icon: UtensilsIcon, status: "live" },
	{ title: "Maintenance", url: "/resort-app#/maintenance", icon: WrenchIcon, status: "live" },
	{ title: "Concierge", url: "#", icon: BellIcon, status: "soon" },
	{ title: "Service desk", url: "/resort-app#/servicedesk", icon: LifeBuoyIcon, status: "live" },
	{ title: "Banquets & events", url: "#", icon: PartyPopperIcon, status: "soon" },
	{ title: "CRM & loyalty", url: "#", icon: HeartHandshakeIcon, status: "soon" },
	{ title: "Analytics", url: "/resort-app#/analytics/revenue", icon: BarChartIcon, status: "live" },
];

const system: NavItem[] = [
	{ title: "Property management", url: "/resort-app#/setup", icon: HotelIcon, status: "live" },
	{ title: "Staff & access", url: "/resort-app#/staff", icon: UsersIcon, status: "live" },
	{ title: "Attendance", url: "/resort-app#/attendance", icon: ClockIcon, status: "live" },
	{ title: "Approvals", url: "/resort-app#/approvals", icon: ShieldCheckIcon, status: "live" },
	{ title: "Audit trail", url: "/resort-app#/audit", icon: DatabaseIcon, status: "live" },
	{ title: "ERPNext desk", url: "/app", icon: DatabaseIcon, status: "live" },
	{ title: "Integrations", url: "/resort-app#/integrations/ota-inbox", icon: PlugIcon, status: "live" },
];

type ActiveFolio = { name: string; guest: string; room: string | null };

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { currentUser } = useFrappeAuth();
	const profile = useUserProfile(currentUser);
	const [folios, setFolios] = useState<ActiveFolio[]>([]);

	useEffect(() => {
		fetch("/api/method/the_reezort.billing.api.get_active_folios", {
			credentials: "include",
			headers: { Accept: "application/json" },
		})
			.then((response) => response.json())
			.then((payload) => {
				const list = payload?.message?.data?.folios;
				if (Array.isArray(list)) setFolios(list);
			})
			.catch(() => {});
	}, []);

	const folioItems: NavItem[] = folios.map((folio) => ({
		title: folio.guest || folio.name,
		url: `/resort-app#/folio/${folio.name}`,
		icon: ReceiptTextIcon,
		status: "live",
	}));

	const user = {
		name: profile?.fullName ?? "Resort staff",
		role: profile?.primaryRole ?? "Staff",
		email: profile?.user ?? "",
		avatar: "",
	};

	// Desk is reserved for admin / accounts / management; operational roles are SPA-only.
	const allowed = allowedSidebarTitles(profile);
	const operationsItems = allowed ? operations.filter((i) => allowed.has(i.title)) : operations;
	const systemBase = canAccessDesk(profile)
		? system
		: system.filter((item) => item.title !== "ERPNext desk");
	const systemItems = allowed ? systemBase.filter((i) => allowed.has(i.title)) : systemBase;

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
				<NavMain label="Operations" items={operationsItems} />
				{folioItems.length > 0 ? <NavMain label="Guest folios · live" items={folioItems} /> : null}
				{systemItems.length > 0 ? <NavMain label="System" items={systemItems} className="mt-auto" /> : null}
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
		</Sidebar>
	);
}
