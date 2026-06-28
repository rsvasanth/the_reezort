import { FrappeProvider } from "frappe-react-sdk";
import type { CSSProperties } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { SectionCards } from "@/components/section-cards";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import data from "@/app/dashboard/data.json";

function App() {
	return (
		<FrappeProvider>
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
					<main className="@container/main flex flex-1 flex-col gap-6 bg-background py-6">
						<section className="px-4 lg:px-6">
							<div className="grid gap-8 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
								<div className="max-w-3xl">
									<div className="mb-6 flex flex-wrap gap-2">
										<Badge variant="outline">Production baseline</Badge>
										<Badge variant="secondary">ERPNext v15</Badge>
										<Badge variant="secondary">Frappe v15</Badge>
									</div>
									<h1 className="max-w-4xl text-5xl font-light leading-[0.94] tracking-[-0.04em] text-foreground md:text-7xl">
										The resort operating system.
									</h1>
									<p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
										Role-based hotel operations on Frappe and ERPNext, starting with property setup,
										room inventory, reservations, folio posting, and executive visibility.
									</p>
								</div>
								<div className="grid gap-3">
									<Button asChild className="rounded-full">
										<a href="/app">Open ERPNext desk</a>
									</Button>
									<Button asChild variant="outline" className="rounded-full">
										<a href="/resort-app">Refresh resort app</a>
									</Button>
								</div>
							</div>
						</section>
						<SectionCards />
						<div className="px-4 lg:px-6">
							<ChartAreaInteractive />
						</div>
						<DataTable data={data} />
					</main>
				</SidebarInset>
			</SidebarProvider>
		</FrappeProvider>
	);
}

export default App;
