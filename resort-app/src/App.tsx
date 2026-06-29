import { FrappeProvider, useFrappeAuth } from "frappe-react-sdk";
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
import PropertyManagementScreen from "@/app/property/PropertyManagementScreen";
import { parseHashRoute, useHashRoute } from "@/hooks/use-hash-route";
import { toOperationalRows, toSectionCards } from "@/lib/dashboard-adapter";
import {
	getManagementDashboardSnapshot,
	type DashboardSnapshot,
} from "@/lib/resort-api";

function FullScreenLoader() {
	return (
		<div className="flex min-h-svh items-center justify-center bg-background">
			<Loader2 className="size-6 animate-spin text-muted-foreground" />
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
			<AppSidebar />
			<SidebarInset>
				<SiteHeader />
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}

function Workspace() {
	const { currentUser, logout } = useFrappeAuth();
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
								<Button asChild className="rounded-full">
									<a href="/app">Open ERPNext desk</a>
								</Button>
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

	if (isLoading) {
		return <FullScreenLoader />;
	}

	if (!currentUser) {
		return <LoginScreen />;
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
	return (
		<FrappeProvider>
			<AuthGate />
			<Toaster richColors closeButton position="top-right" />
		</FrappeProvider>
	);
}

export default App;
