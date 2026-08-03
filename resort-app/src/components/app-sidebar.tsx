"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
	BanknoteIcon,
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
	SettingsIcon,
	ShieldCheckIcon,
	SparklesIcon,
	UsersIcon,
	UtensilsIcon,
	UtensilsCrossedIcon,
	WrenchIcon,
} from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";

import { NavMain, type NavCategory, type NavItem } from "@/components/nav-main";
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
	SidebarRail,
} from "@/components/ui/sidebar";

// The cockpit is the landing screen, so it stays a flat row rather than being
// buried one click into a category.
const overview: NavItem[] = [
	{ title: "Executive cockpit", url: "/resort-app#/cockpit", icon: LayoutDashboardIcon, status: "live" },
];

/**
 * Operational modules, grouped. These were previously nineteen flat rows, which
 * with System and live folios put 26+ links in one scroll — the sidebar could
 * not be read at a glance and did not fit shorter screens. Categories collapse,
 * so the resting state is eight rows.
 *
 * Titles are unchanged: role gating filters by exact title
 * (`allowedSidebarTitles`), so renaming an item silently removes it for every
 * gated role.
 */
const categories: NavCategory[] = [
	{
		title: "Front office",
		icon: BedDoubleIcon,
		items: [
			{ title: "Reservations", url: "/resort-app#/reservations", icon: CalendarDaysIcon, status: "live" },
			{ title: "Front desk", url: "/resort-app#/frontdesk", icon: BedDoubleIcon, status: "live" },
		],
	},
	{
		title: "Housekeeping",
		icon: SparklesIcon,
		items: [
			{ title: "Housekeeping", url: "/resort-app#/housekeeping", icon: SparklesIcon, status: "live" },
			{ title: "My tasks", url: "/resort-app#/my-tasks", icon: ListChecksIcon, status: "live" },
			{ title: "All tasks", url: "/resort-app#/tasks", icon: ClipboardListIcon, status: "live" },
		],
	},
	{
		title: "Billing",
		icon: ReceiptTextIcon,
		items: [
			{ title: "Billing", url: "/resort-app#/billing", icon: ReceiptTextIcon, status: "live" },
			{ title: "Direct billing", url: "/resort-app#/direct-bill", icon: ReceiptTextIcon, status: "live" },
			{ title: "Charge to room", url: "/resort-app#/charge-room", icon: ReceiptTextIcon, status: "live" },
			{ title: "Cashier close", url: "/resort-app#/cashier-close", icon: BanknoteIcon, status: "live" },
		],
	},
	{
		title: "Food & beverage",
		icon: UtensilsIcon,
		items: [
			{ title: "Restaurant & bar", url: "/resort-app#/restaurant", icon: UtensilsIcon, status: "live" },
			{ title: "Restaurant mgmt", url: "/resort-app#/restaurant/management", icon: UtensilsCrossedIcon, status: "live" },
		],
	},
	{
		title: "Engineering",
		icon: WrenchIcon,
		items: [
			{ title: "Maintenance", url: "/resort-app#/maintenance", icon: WrenchIcon, status: "live" },
			{ title: "Engineering board", url: "/resort-app#/maintenance/engineering", icon: WrenchIcon, status: "live" },
		],
	},
	{
		title: "Guest services",
		icon: BellIcon,
		items: [
			{ title: "Concierge", url: "/resort-app#/guest-relations", icon: BellIcon, status: "live" },
			{ title: "Service desk", url: "/resort-app#/servicedesk", icon: LifeBuoyIcon, status: "live" },
			{ title: "Banquets & events", url: "#", icon: PartyPopperIcon, status: "soon" },
		],
	},
	{
		title: "Insight",
		icon: BarChartIcon,
		items: [
			{ title: "CRM & loyalty", url: "/resort-app#/crm", icon: HeartHandshakeIcon, status: "live" },
			{ title: "Analytics", url: "/resort-app#/analytics/revenue", icon: BarChartIcon, status: "live" },
		],
	},
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
	const keep = (items: NavItem[]) => (allowed ? items.filter((i) => allowed.has(i.title)) : items);

	const overviewItems = keep(overview);
	// Filter inside each category, then drop any category left empty — a gated
	// role should not see an expandable section with nothing behind it.
	const visibleCategories = categories
		.map((category) => ({ ...category, items: keep(category.items) }))
		.filter((category) => category.items.length > 0);

	const systemBase = canAccessDesk(profile)
		? system
		: system.filter((item) => item.title !== "ERPNext desk");
	const systemItems = keep(systemBase);
	const systemCategory: NavCategory[] =
		systemItems.length > 0
			? [{ title: "System", icon: SettingsIcon, items: systemItems }]
			: [];

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="THE REEZORT">
							<a href="/resort-app">
								<HotelIcon className="h-5 w-5" />
								<span className="text-base font-medium">THE REEZORT</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain label="Operations" items={overviewItems} categories={visibleCategories} />
				{folioItems.length > 0 ? (
					<NavMain label="Guest folios · live" items={folioItems} />
				) : null}
				<NavMain categories={systemCategory} className="mt-auto" />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
