/**
 * PropertyWorkspace / BuildingWorkspace / FloorWorkspace — full main-area
 * layouts (spec 001). Deep-linkable at:
 *   · #/property/<name>
 *   · #/building/<name>
 *   · #/floor/<name>
 *
 * Each replaces the earlier right-slide sheet. Content:
 *   · Header — name, code, counts, back link
 *   · Rooms grid — every room the scope contains, click-through to
 *     RoomWorkspace
 *   · Engagement timeline — cross-doctype activity for the scope
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EngagementTimeline } from "@/components/property/engagement-timeline";
import {
	getBuildingTimeline,
	getFloorTimeline,
	getPropertyTimeline,
	type TimelineEvent,
} from "@/lib/timeline-api";
import {
	FolioApiError,
	getPropertyTree,
	listSetupOptions,
	type PropertyTree,
	type TreeRoom,
} from "@/lib/setup-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<SidebarProvider
			style={{ "--sidebar-width": "18rem", "--header-height": "3rem" } as CSSProperties}
		>
			<AppSidebar />
			<SidebarInset className="bg-transparent">
				<SiteHeader />
				<div className="flex flex-1 flex-col outline-none">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

type Scope = "property" | "building" | "floor";

async function loadTreeContaining(kind: Scope, code: string): Promise<PropertyTree | null> {
	const opts = await listSetupOptions();
	for (const p of opts.properties) {
		const t = await getPropertyTree(p.name);
		if (kind === "property" && t.resort_property === code) return t;
		if (kind === "building" && t.buildings.some((b) => b.name === code)) return t;
		if (kind === "floor" && t.floors.some((f) => f.name === code)) return t;
	}
	return null;
}

function filterRoomsFor(tree: PropertyTree, kind: Scope, code: string): TreeRoom[] {
	if (kind === "property") return tree.rooms;
	if (kind === "building") return tree.rooms.filter((r) => r.building === code);
	if (kind === "floor") return tree.rooms.filter((r) => r.floor === code);
	return [];
}

async function loadTimeline(kind: Scope, code: string): Promise<TimelineEvent[]> {
	try {
		if (kind === "property") return (await getPropertyTimeline(code)).events;
		if (kind === "building") return (await getBuildingTimeline(code)).events;
		if (kind === "floor") return (await getFloorTimeline(code)).events;
		return [];
	} catch {
		return [];
	}
}

function scopeLabel(kind: Scope): string {
	if (kind === "property") return "Property";
	if (kind === "building") return "Building";
	return "Floor";
}

function scopeTitle(tree: PropertyTree, kind: Scope, code: string): { title: string; sub: string | null } {
	if (kind === "property") {
		return { title: tree.resort_property, sub: null };
	}
	if (kind === "building") {
		const b = tree.buildings.find((x) => x.name === code);
		return {
			title: b?.building_name ?? code,
			sub: b?.building_code ?? null,
		};
	}
	const f = tree.floors.find((x) => x.name === code);
	return {
		title: f?.floor_label ?? code,
		sub: f?.floor_code ?? null,
	};
}

export function ScopeWorkspace({ kind, code }: { kind: Scope; code: string | null }) {
	const [tree, setTree] = useState<PropertyTree | null>(null);
	const [events, setEvents] = useState<TimelineEvent[]>([]);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		if (!code) return;
		setLoading(true);
		try {
			const [t, ev] = await Promise.all([
				loadTreeContaining(kind, code),
				loadTimeline(kind, code),
			]);
			setTree(t);
			setEvents(ev);
		} catch (error) {
			reportError(error, `Could not load ${scopeLabel(kind).toLowerCase()}`);
		} finally {
			setLoading(false);
		}
	}, [kind, code]);

	useEffect(() => { load(); }, [load]);

	if (!code) {
		return (
			<AppShell>
				<main className="flex flex-1 items-center justify-center px-6 py-8 text-sm text-muted-foreground">
					No {scopeLabel(kind).toLowerCase()} selected.
				</main>
			</AppShell>
		);
	}

	if (loading) {
		return (
			<AppShell>
				<main className="flex flex-1 items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading {scopeLabel(kind).toLowerCase()}…
				</main>
			</AppShell>
		);
	}

	if (!tree) {
		return (
			<AppShell>
				<main className="flex flex-1 items-center justify-center px-6 py-8 text-sm text-muted-foreground">
					{scopeLabel(kind)} not found: {code}
				</main>
			</AppShell>
		);
	}

	const rooms = filterRoomsFor(tree, kind, code);
	const { title, sub } = scopeTitle(tree, kind, code);
	const counts = {
		buildings: kind === "property" ? tree.counts.buildings : (kind === "building" ? 1 : undefined),
		floors: kind === "floor" ? 1 : (tree.floors.filter((f) => kind === "property" || tree.rooms.some((r) => r.floor === f.name && rooms.includes(r))).length),
		rooms: rooms.length,
	};

	return (
		<AppShell>
			<main className="flex flex-1 flex-col gap-6  px-4 py-6 lg:px-6" data-testid={`${kind}-workspace`}>
				<header className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<div className="mb-2 flex items-center gap-2">
							<Button variant="ghost" size="sm" asChild>
								<a href="#/setup"><ArrowLeft className="size-4" /> Property management</a>
							</Button>
							<Badge variant="outline">{scopeLabel(kind)}</Badge>
						</div>
						<h1 className="text-3xl font-light text-foreground md:text-4xl">{title}</h1>
						{sub ? <div className="mt-1 text-sm text-muted-foreground">{sub}</div> : null}
						<div className="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
							{counts.buildings !== undefined ? <Badge variant="secondary">{counts.buildings} buildings</Badge> : null}
							<Badge variant="secondary">{counts.floors} floors</Badge>
							<Badge variant="secondary">{counts.rooms} rooms</Badge>
						</div>
					</div>
				</header>

				<Tabs defaultValue="rooms">
					<TabsList>
						<TabsTrigger value="rooms">Rooms</TabsTrigger>
						<TabsTrigger value="timeline" data-testid={`${kind}-tab-timeline`}>Timeline</TabsTrigger>
					</TabsList>

					<TabsContent value="rooms" className="mt-4">
						{rooms.length === 0 ? (
							<Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
								No rooms in this {scopeLabel(kind).toLowerCase()} yet.
							</CardContent></Card>
						) : (
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								{rooms.map((r) => (
									<a
										key={r.name}
										href={`#/room/${encodeURIComponent(r.name)}`}
										className="block overflow-hidden rounded-md border bg-card transition-colors hover:bg-accent/40"
										data-testid={`room-tile-${r.name}`}
									>
										{r.image ? (
											<img src={r.image} alt={r.room_number} className="aspect-[16/10] w-full object-cover" />
										) : (
											<div className="flex aspect-[16/10] w-full items-center justify-center bg-gradient-to-br from-stone-200 to-stone-100 text-sm font-medium text-muted-foreground dark:from-stone-800 dark:to-stone-900 dark:text-muted-foreground">
												{r.room_number}
											</div>
										)}
										<div className="p-3">
											<div className="flex items-center justify-between">
												<div className="text-base font-medium">{r.room_number}</div>
												<Badge variant="outline" className="text-[10px]">{r.occupancy_status}</Badge>
											</div>
											{r.room_name ? (
												<div className="mt-0.5 text-xs text-muted-foreground">{r.room_name}</div>
											) : null}
											<div className="mt-2 flex flex-wrap gap-1">
												<Badge variant="secondary" className="text-[10px]">{r.housekeeping_status}</Badge>
												<Badge
													variant={r.maintenance_status === "Available" ? "secondary" : "destructive"}
													className="text-[10px]"
												>
													{r.maintenance_status}
												</Badge>
											</div>
										</div>
									</a>
								))}
							</div>
						)}
					</TabsContent>

					<TabsContent value="timeline" className="mt-4">
						<EngagementTimeline events={events} />
					</TabsContent>
				</Tabs>
			</main>
		</AppShell>
	);
}

export default function PropertyWorkspace({ code }: { code: string | null }) {
	return <ScopeWorkspace kind="property" code={code} />;
}
export function BuildingWorkspace({ code }: { code: string | null }) {
	return <ScopeWorkspace kind="building" code={code} />;
}
export function FloorWorkspace({ code }: { code: string | null }) {
	return <ScopeWorkspace kind="floor" code={code} />;
}
