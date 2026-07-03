/**
 * RestaurantManagementScreen — #/restaurant/management (spec 006 · Slice 5).
 *
 * The F&B manager's hub over the live `the_reezort.fnb.management` module.
 * A shared outlet filter in the header, then five tabs, each owning its own
 * time control (range / month / date / days) because they don't share a
 * window:
 *   · Sales      — KPI strip, daily trend, top dishes, sales by waiter
 *   · Calendar   — month grid of revenue / orders / top dish / waste
 *   · Dishes     — velocity + margin + trend, plus slow movers
 *   · Shifts     — waiter assignment board with assign / unassign
 *   · Audit      — every recorded Restaurant Order action
 *
 * Mount inside <AppShell>.
 */

import { useEffect, useState } from "react";
import { UtensilsCrossed } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listOutlets, type FnbOutlet } from "@/lib/fnb-api";

import SalesAnalyticsTab from "./SalesAnalyticsTab";
import SalesCalendarTab from "./SalesCalendarTab";
import DishPerformanceTab from "./DishPerformanceTab";
import WaiterShiftsTab from "./WaiterShiftsTab";
import RestaurantAuditTab from "./RestaurantAuditTab";

// Radix Select can't hold an empty-string value, so "All outlets" uses a
// sentinel that maps back to undefined (= every outlet) at the API boundary.
const ALL_OUTLETS = "__all__";

export default function RestaurantManagementScreen() {
	const [outlets, setOutlets] = useState<FnbOutlet[]>([]);
	const [outletValue, setOutletValue] = useState<string>(ALL_OUTLETS);

	useEffect(() => {
		listOutlets()
			.then((res) => setOutlets(res.outlets))
			.catch(() => {
				// Network failure before deploy: seed one outlet so the picker isn't
				// empty. A live 4xx just leaves "All outlets" — the tabs surface the
				// real error themselves.
				setOutlets([
					{
						name: "Signature Restaurant",
						outlet_name: "Signature Restaurant",
						outlet_code: "SIGREST",
						outlet_type: "Restaurant",
						is_default: 1,
						default_service_charge_pct: null,
					},
				]);
			});
	}, []);

	const outlet = outletValue === ALL_OUTLETS ? "" : outletValue;

	return (
		<main
			className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6"
			data-testid="restaurant-management"
		>
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<Badge variant="outline" className="mb-2 gap-1">
						<UtensilsCrossed className="size-3" /> Restaurant management
					</Badge>
					<h1 className="text-3xl font-light text-foreground md:text-4xl">Restaurant management</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Sales, calendar, dish performance, shifts, and the audit trail — across your outlets.
					</p>
				</div>
				<Select value={outletValue} onValueChange={setOutletValue}>
					<SelectTrigger className="w-56" data-testid="management-outlet">
						<SelectValue placeholder="All outlets" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_OUTLETS}>All outlets</SelectItem>
						{outlets.map((o) => (
							<SelectItem key={o.name} value={o.name}>
								{o.outlet_name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</header>

			<Tabs defaultValue="sales" className="w-full">
				<TabsList data-testid="management-tabs">
					<TabsTrigger value="sales">Sales</TabsTrigger>
					<TabsTrigger value="calendar">Calendar</TabsTrigger>
					<TabsTrigger value="dishes">Dishes</TabsTrigger>
					<TabsTrigger value="shifts">Shifts</TabsTrigger>
					<TabsTrigger value="audit">Audit</TabsTrigger>
				</TabsList>
				<TabsContent value="sales" className="mt-4">
					<SalesAnalyticsTab outlet={outlet} />
				</TabsContent>
				<TabsContent value="calendar" className="mt-4">
					<SalesCalendarTab outlet={outlet} />
				</TabsContent>
				<TabsContent value="dishes" className="mt-4">
					<DishPerformanceTab outlet={outlet} />
				</TabsContent>
				<TabsContent value="shifts" className="mt-4">
					<WaiterShiftsTab outlet={outlet} outlets={outlets} />
				</TabsContent>
				<TabsContent value="audit" className="mt-4">
					<RestaurantAuditTab />
				</TabsContent>
			</Tabs>
		</main>
	);
}
