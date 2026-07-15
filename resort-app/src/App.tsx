import { FrappeProvider, useFrappeAuth } from "frappe-react-sdk";
import { MotionConfig } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { LoginScreen } from "@/components/login-screen";
import { SectionCards } from "@/components/section-cards";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import data from "@/app/dashboard/data.json";
import { FolioWorkspace } from "@/app/folio/FolioWorkspace";
import HousekeepingBoard from "@/app/housekeeping/HousekeepingBoard";
import ConditionCaptureScreen from "@/app/condition/ConditionCaptureScreen";
import CheckInScreen from "@/app/checkin/CheckInScreen";
import MyTasksScreen from "@/app/tasks/MyTasksScreen";
import AllTasksScreen from "@/app/tasks/AllTasksScreen";
import PropertyManagementScreen from "@/app/property/PropertyManagementScreen";
import StaffAccessScreen from "@/app/staff/StaffAccessScreen";
import AttendanceScreen from "@/app/staff/AttendanceScreen";
import MyDayScreen from "@/app/staff/MyDayScreen";
import RoomWorkspace from "@/app/property/RoomWorkspace";
import PropertyWorkspace, { BuildingWorkspace, FloorWorkspace } from "@/app/property/PropertyWorkspace";
import ApprovalsInboxScreen from "@/app/compliance/ApprovalsInboxScreen";
import AuditTrailScreen from "@/app/compliance/AuditTrailScreen";
import ServiceDeskScreen from "@/app/servicedesk/ServiceDeskScreen";
import BillingOverviewScreen from "@/app/billing/BillingOverviewScreen";
import DirectBillScreen from "@/app/billing/DirectBillScreen";
import BookingFlow from "@/app/book/BookingFlow";
import CashierCloseScreen from "@/app/backoffice/CashierCloseScreen";
import FrontDeskScreen from "@/app/frontdesk/FrontDeskScreen";
import ReservationsScreen from "@/app/reservations/ReservationsScreen";
import ReservationForecastScreen from "@/app/reservations/ReservationForecast";
import RestaurantFloor from "@/app/restaurant/RestaurantFloor";
import TableOrderScreen from "@/app/restaurant/TableOrderScreen";
import KitchenScreen from "@/app/restaurant/KitchenScreen";
import RestaurantManagementScreen from "@/app/restaurant/management/RestaurantManagementScreen";
import MaintenanceInbox from "@/app/maintenance/MaintenanceInbox";
import EngineeringBoard from "@/app/maintenance/EngineeringBoard";
import RevenueDashboard from "@/app/analytics/RevenueDashboard";
import OtaInbox from "@/app/integrations/OtaInbox";
import GuestRelations from "@/app/guest-services/GuestRelations";
import GuestList from "@/app/crm/GuestList";
import Guest360 from "@/app/crm/Guest360";
import { parseHashRoute, useHashRoute } from "@/hooks/use-hash-route";
import { canAccessDesk, defaultLandingRoute, useUserProfile } from "@/hooks/use-user-profile";
import { useVersionCheck } from "@/hooks/use-version-check";
import { toOperationalRows, toSectionCards } from "@/lib/dashboard-adapter";
import {
	getManagementDashboardSnapshot,
	type DashboardSnapshot,
} from "@/lib/resort-api";

function FullScreenLoader() {
	return (
		<div role="status" className="flex min-h-svh items-center justify-center bg-background">
			<Loader2 className="size-6 animate-spin text-muted-foreground" />
			<span className="sr-only">Loading…</span>
		</div>
	);
}

function AppShell({ children }: { children: ReactNode }) {
	return (
		<SidebarProvider
			style={
				{
					"--sidebar-width": "18rem",
					"--header-height": "3rem",
				} as CSSProperties
			}
		>
			<a
				href="#main-content"
				className="sr-only rounded-md bg-background px-3 py-2 text-sm shadow ring-2 ring-ring focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
			>
				Skip to main content
			</a>
			<AppSidebar />
			<SidebarInset>
				<SiteHeader />
				<div id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

function Workspace() {
	const { currentUser, logout } = useFrappeAuth();
	const profile = useUserProfile(currentUser);
	const showDesk = canAccessDesk(profile);
	const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
	const [snapshotState, setSnapshotState] = useState<"loading" | "live" | "mock">(
		"loading"
	);

	useEffect(() => {
		let active = true;

		getManagementDashboardSnapshot()
			.then((nextSnapshot) => {
				if (!active) return;
				setSnapshot(nextSnapshot);
				setSnapshotState("live");
			})
			.catch(() => {
				if (!active) return;
				setSnapshot(null);
				setSnapshotState("mock");
			});

		return () => {
			active = false;
		};
	}, []);

	const cards = useMemo(
		() => (snapshot ? toSectionCards(snapshot) : undefined),
		[snapshot]
	);
	const tableData = useMemo(
		() => (snapshot ? toOperationalRows(snapshot) : data),
		[snapshot]
	);

	return (
		<SidebarProvider
			style={
				{
					"--sidebar-width": "18rem",
					"--header-height": "3rem",
				} as CSSProperties
			}
		>
			<AppSidebar />
			<SidebarInset>
				<SiteHeader />
				<main className="flex flex-1 flex-col gap-6 bg-background py-6">
					<section className="px-4 lg:px-6">
						<div className="grid gap-8 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
							<div className="max-w-3xl">
								<div className="mb-6 flex flex-wrap gap-2">
									<Badge variant="outline">
										{snapshotState === "live"
											? "Live Frappe data"
											: snapshotState === "loading"
												? "Loading data"
												: "Mock fallback"}
									</Badge>
									<Badge variant="secondary">Management preview</Badge>
									<Badge variant="secondary">
										{snapshot?.property ?? "ERPNext v15"}
									</Badge>
								</div>
								<h1 className="max-w-4xl text-5xl font-light leading-[0.94] text-foreground md:text-7xl">
									Resort management cockpit.
								</h1>
								<p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
									A prototype view for daily leadership review: occupancy, revenue pace, arrivals,
									room readiness, service load, and operational exceptions across the resort.
								</p>
							</div>
							<div className="grid gap-3">
								{showDesk ? (
									<Button asChild className="rounded-full">
										<a href="/app">Open ERPNext desk</a>
									</Button>
								) : null}
								<Button asChild variant="outline" className="rounded-full">
									<a href="/resort-app">Refresh prototype</a>
								</Button>
								<div className="flex items-center justify-between gap-2 pt-1 text-sm text-muted-foreground">
									<span className="truncate">{currentUser}</span>
									<Button
										variant="ghost"
										size="sm"
										className="rounded-full"
										onClick={() => logout()}
									>
										Sign out
									</Button>
								</div>
							</div>
						</div>
					</section>
					<SectionCards cards={cards} />
					<div className="px-4 lg:px-6">
						<ChartAreaInteractive />
					</div>
					<DataTable data={tableData} />
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}

function AuthGate() {
	const { currentUser, isLoading } = useFrappeAuth();
	const hash = useHashRoute();
	const route = parseHashRoute(hash);
	const profile = useUserProfile(currentUser ?? null);

	// Redirect operational roles to their workspace if they land on the bare URL.
	useEffect(() => {
		if (!currentUser || !profile) return;
		if (hash && hash !== "" && hash !== "#" && hash !== "#/") return;
		const target = defaultLandingRoute(profile);
		if (target) window.location.hash = target;
	}, [currentUser, profile, hash]);

	// Public guest booking — reachable without a login/session.
	if (route.kind === "book") {
		return <BookingFlow />;
	}

	if (isLoading) {
		return <FullScreenLoader />;
	}

	if (!currentUser) {
		return <LoginScreen />;
	}

	if (route.kind === "cockpit") {
		return <Workspace />;
	}

	if (route.kind === "folio") {
		return <FolioWorkspace folioName={route.name} />;
	}

	if (route.kind === "housekeeping") {
		return <HousekeepingBoard />;
	}

	if (route.kind === "setup") {
		return (
			<AppShell>
				<PropertyManagementScreen />
			</AppShell>
		);
	}

	if (route.kind === "staff") {
		return (
			<AppShell>
				<StaffAccessScreen />
			</AppShell>
		);
	}

	if (route.kind === "attendance") {
		return (
			<AppShell>
				<AttendanceScreen />
			</AppShell>
		);
	}

	if (route.kind === "servicedesk") {
		return (
			<AppShell>
				<ServiceDeskScreen />
			</AppShell>
		);
	}

	if (route.kind === "billing") {
		return (
			<AppShell>
				<BillingOverviewScreen />
			</AppShell>
		);
	}

	if (route.kind === "direct-bill") {
		return (
			<AppShell>
				<DirectBillScreen />
			</AppShell>
		);
	}

	if (route.kind === "frontdesk") {
		return (
			<AppShell>
				<FrontDeskScreen />
			</AppShell>
		);
	}

	if (route.kind === "reservation-forecast") {
		return (
			<AppShell>
				<ReservationForecastScreen />
			</AppShell>
		);
	}

	if (route.kind === "reservations") {
		return (
			<AppShell>
				<ReservationsScreen id={route.id} />
			</AppShell>
		);
	}

	if (route.kind === "restaurant") {
		return (
			<AppShell>
				<RestaurantFloor />
			</AppShell>
		);
	}

	if (route.kind === "restaurant-table") {
		return (
			<AppShell>
				<TableOrderScreen order={route.order} />
			</AppShell>
		);
	}

	if (route.kind === "restaurant-kitchen") {
		return (
			<AppShell>
				<KitchenScreen />
			</AppShell>
		);
	}

	if (route.kind === "restaurant-management") {
		return (
			<AppShell>
				<RestaurantManagementScreen />
			</AppShell>
		);
	}

	if (route.kind === "maintenance") {
		return (
			<AppShell>
				<MaintenanceInbox />
			</AppShell>
		);
	}

	if (route.kind === "engineering-board") {
		return (
			<AppShell>
				<EngineeringBoard />
			</AppShell>
		);
	}

	if (route.kind === "cashier-close") {
		return (
			<AppShell>
				<CashierCloseScreen />
			</AppShell>
		);
	}

	if (route.kind === "analytics-revenue") {
		return (
			<AppShell>
				<RevenueDashboard />
			</AppShell>
		);
	}

	if (route.kind === "ota-inbox") {
		return (
			<AppShell>
				<OtaInbox />
			</AppShell>
		);
	}

	if (route.kind === "guest-relations") {
		return (
			<AppShell>
				<GuestRelations />
			</AppShell>
		);
	}

	if (route.kind === "crm") {
		return (
			<AppShell>
				<GuestList />
			</AppShell>
		);
	}

	if (route.kind === "guest" && route.id) {
		return (
			<AppShell>
				<Guest360 guestProfile={route.id} />
			</AppShell>
		);
	}

	if (route.kind === "checkin" && route.reservation) {
		return (
			<AppShell>
				<CheckInScreen reservation={route.reservation} />
			</AppShell>
		);
	}

	if (route.kind === "mytasks") {
		return (
			<AppShell>
				<MyTasksScreen />
			</AppShell>
		);
	}

	if (route.kind === "myday") {
		return (
			<AppShell>
				<MyDayScreen />
			</AppShell>
		);
	}

	if (route.kind === "room") {
		return <RoomWorkspace roomName={route.code} />;
	}

	if (route.kind === "property") {
		return <PropertyWorkspace code={route.code} />;
	}

	if (route.kind === "building") {
		return <BuildingWorkspace code={route.code} />;
	}

	if (route.kind === "floor") {
		return <FloorWorkspace code={route.code} />;
	}

	if (route.kind === "approvals") {
		return (
			<AppShell>
				<ApprovalsInboxScreen />
			</AppShell>
		);
	}

	if (route.kind === "audit") {
		return (
			<AppShell>
				<AuditTrailScreen />
			</AppShell>
		);
	}

	if (route.kind === "tasks") {
		return (
			<AppShell>
				<AllTasksScreen />
			</AppShell>
		);
	}

	if (route.kind === "condition" && route.stay) {
		return (
			<AppShell>
				<ConditionCaptureScreen stay={route.stay} />
			</AppShell>
		);
	}

	return <Workspace />;
}

function App() {
	useVersionCheck();
	return (
		<FrappeProvider>
			<MotionConfig reducedMotion="user">
				<AuthGate />
				<Toaster richColors closeButton position="top-right" />
			</MotionConfig>
		</FrappeProvider>
	);
}

export default App;
