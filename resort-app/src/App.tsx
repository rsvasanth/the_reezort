import { FrappeProvider } from "frappe-react-sdk";
import {
	ArrowUpRight,
	BadgeCheck,
	BarChart3,
	BedDouble,
	CalendarDays,
	CheckCircle2,
	CreditCard,
	Database,
	Hotel,
	LayoutDashboard,
	Layers3,
	Server,
	ShieldCheck,
	Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type Lane = {
	title: string;
	focus: string;
	status: string;
	icon: LucideIcon;
	tone: string;
};

const setupStatus = [
	{ label: "Frappe v15", value: "15.113.1", icon: Server },
	{ label: "ERPNext v15", value: "15.114.0", icon: Database },
	{ label: "Resort app", value: "0.0.1", icon: Layers3 },
	{ label: "React SPA", value: "Doppio", icon: LayoutDashboard },
];

const stakeholderLanes: Lane[] = [
	{
		title: "General Manager",
		focus: "Property performance",
		status: "Spec locked",
		icon: BarChart3,
		tone: "bg-sky-500",
	},
	{
		title: "Front Desk",
		focus: "Arrivals and stays",
		status: "Next",
		icon: Hotel,
		tone: "bg-emerald-500",
	},
	{
		title: "Reservations",
		focus: "Booking pipeline",
		status: "Planned",
		icon: CalendarDays,
		tone: "bg-violet-500",
	},
	{
		title: "Housekeeping",
		focus: "Room readiness",
		status: "Planned",
		icon: BedDouble,
		tone: "bg-amber-500",
	},
	{
		title: "Finance",
		focus: "ERPNext postings",
		status: "Boundary set",
		icon: CreditCard,
		tone: "bg-rose-500",
	},
	{
		title: "Maintenance",
		focus: "Room and asset work",
		status: "Planned",
		icon: Wrench,
		tone: "bg-cyan-500",
	},
];

const sprintGuardrails = [
	"001 Property Setup and Room Inventory starts first",
	"007 Spa and Ancillary Services stays parked",
	"ERPNext remains the business ledger",
	"Backend permissions remain final authority",
];

function App() {
	return (
		<FrappeProvider>
			<main className="min-h-screen bg-background">
				<section className="border-b bg-card">
					<div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 sm:px-6 lg:px-8">
						<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
							<div className="min-w-0">
								<div className="mb-3 flex flex-wrap items-center gap-2">
									<Badge variant="success" className="gap-1.5">
										<CheckCircle2 className="size-3.5" />
										Sprint 0
									</Badge>
									<Badge variant="outline">the-reezort.localhost</Badge>
								</div>
								<h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
									THE REEZORT
								</h1>
								<p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
									Frappe, ERPNext, the custom resort app, and the Doppio React surface are now aligned
									for the first implementation sprint.
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button asChild>
									<a href="/app">
										Open Desk
										<ArrowUpRight />
									</a>
								</Button>
								<Button asChild variant="outline">
									<a href="/resort-app">
										SPA Route
										<ArrowUpRight />
									</a>
								</Button>
							</div>
						</div>
					</div>
				</section>

				<section className="mx-auto grid max-w-7xl gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[1.5fr_1fr] lg:px-8">
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between gap-3">
								<div>
									<CardTitle>Stakeholder Workspaces</CardTitle>
									<CardDescription>Role surfaces queued from the approved spec set.</CardDescription>
								</div>
								<Badge variant="secondary">First year scope</Badge>
							</div>
						</CardHeader>
						<CardContent>
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{stakeholderLanes.map((lane) => (
									<div
										key={lane.title}
										className="flex min-h-24 items-start gap-3 rounded-lg border bg-background p-4"
									>
										<span className={`mt-1 flex size-9 items-center justify-center rounded-md ${lane.tone} text-white`}>
											<lane.icon className="size-4" />
										</span>
										<div className="min-w-0">
											<p className="font-medium leading-5">{lane.title}</p>
											<p className="mt-1 text-sm text-muted-foreground">{lane.focus}</p>
											<p className="mt-2 text-xs font-medium text-foreground">{lane.status}</p>
										</div>
									</div>
								))}
							</div>
						</CardContent>
					</Card>

					<div className="grid gap-4">
						<Card>
							<CardHeader>
								<CardTitle>Setup Stack</CardTitle>
								<CardDescription>Installed local development foundation.</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								{setupStatus.map((item) => (
									<div key={item.label} className="flex items-center justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<span className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
												<item.icon className="size-4" />
											</span>
											<span className="truncate text-sm font-medium">{item.label}</span>
										</div>
										<Badge variant="outline">{item.value}</Badge>
									</div>
								))}
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<div className="flex items-center gap-2">
									<ShieldCheck className="size-5 text-emerald-600" />
									<CardTitle>Sprint Guardrails</CardTitle>
								</div>
							</CardHeader>
							<CardContent className="space-y-3">
								{sprintGuardrails.map((item, index) => (
									<div key={item}>
										<div className="flex gap-3 text-sm">
											<BadgeCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
											<span>{item}</span>
										</div>
										{index < sprintGuardrails.length - 1 ? <Separator className="mt-3" /> : null}
									</div>
								))}
							</CardContent>
						</Card>
					</div>
				</section>
			</main>
		</FrappeProvider>
	);
}

export default App;
