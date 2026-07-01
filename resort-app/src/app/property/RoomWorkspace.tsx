/**
 * RoomWorkspace — full main-area layout for a single Room (spec 001).
 *
 * Replaces the right-side RoomSheet. Deep-linkable at #/room/<name>. Renders
 * inside its own AppShell (mirrors FolioWorkspace). Tabs:
 *   · Overview — basics + statuses form
 *   · Equipment — WiFi/TV/AC etc. with per-item condition
 *   · Timeline — cross-doctype engagement history for this room
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EngagementTimeline } from "@/components/property/engagement-timeline";
import { RoomInsightsPanel } from "@/components/property/room-insights";
import { getRoomTimeline, type TimelineEvent } from "@/lib/timeline-api";
import {
	EQUIPMENT_CONDITIONS,
	FolioApiError,
	getPropertyTree,
	getRoomEquipment,
	listAmenities,
	listSetupOptions,
	setRoomEquipment,
	updateRecord,
	type Amenity,
	type EquipmentCondition,
	type PropertyTree,
	type RoomEquipmentItem,
	type TreeRoom,
	type TreeRoomType,
} from "@/lib/setup-api";

const OCCUPANCY = ["Vacant", "Reserved", "Occupied", "Due In", "Due Out", "Checked Out", "Hold"];
const HOUSEKEEPING = ["Clean", "Dirty", "In Progress", "Inspected", "Pickup", "Turndown Required", "Out of Service Cleaning"];
const MAINTENANCE = ["Available", "Maintenance Requested", "Under Maintenance", "Out of Order", "Out of Service", "Preventive Maintenance"];
const SELLABLE = ["Sellable", "Not Sellable", "Restricted", "Temporarily Blocked"];
const SMOKING = ["Non-Smoking", "Smoking", "Flexible"];

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
			<SidebarInset>
				<SiteHeader />
				<div className="flex flex-1 flex-col outline-none">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

export default function RoomWorkspace({ roomName }: { roomName: string | null }) {
	const [room, setRoom] = useState<TreeRoom | null>(null);
	const [tree, setTree] = useState<PropertyTree | null>(null);
	const [amenities, setAmenities] = useState<Amenity[]>([]);
	const [equipment, setEquipment] = useState<RoomEquipmentItem[]>([]);
	const [events, setEvents] = useState<TimelineEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState({
		room_name: "",
		room_type: "",
		smoking_policy: "",
		occupancy_status: "",
		housekeeping_status: "",
		maintenance_status: "",
		sellable_status: "",
	});

	const load = useCallback(async () => {
		if (!roomName) return;
		setLoading(true);
		try {
			const opts = await listSetupOptions();
			let foundRoom: TreeRoom | null = null;
			let foundTree: PropertyTree | null = null;
			for (const p of opts.properties) {
				const t = await getPropertyTree(p.name);
				const r = t.rooms.find((rr) => rr.name === roomName);
				if (r) {
					foundRoom = r;
					foundTree = t;
					break;
				}
			}
			if (!foundRoom || !foundTree) {
				toast.error("Room not found", { description: roomName });
				setLoading(false);
				return;
			}
			setRoom(foundRoom);
			setTree(foundTree);
			setForm({
				room_name: foundRoom.room_name ?? "",
				room_type: foundRoom.room_type ?? "",
				smoking_policy: foundRoom.smoking_policy ?? "Non-Smoking",
				occupancy_status: foundRoom.occupancy_status ?? "Vacant",
				housekeeping_status: foundRoom.housekeeping_status ?? "Clean",
				maintenance_status: foundRoom.maintenance_status ?? "Available",
				sellable_status: foundRoom.sellable_status ?? "Sellable",
			});
			const [am, eq, tl] = await Promise.all([
				listAmenities(),
				getRoomEquipment(foundRoom.name).catch(() => ({ items: [] as RoomEquipmentItem[] })),
				getRoomTimeline(foundRoom.name).catch(() => ({ target: { doctype: "Room", name: foundRoom.name }, events: [] as TimelineEvent[] })),
			]);
			setAmenities(am.amenities);
			setEquipment(eq.items);
			setEvents(tl.events);
		} catch (error) {
			reportError(error, "Could not load room");
		} finally {
			setLoading(false);
		}
	}, [roomName]);

	useEffect(() => { load(); }, [load]);

	async function save() {
		if (!room) return;
		setSaving(true);
		try {
			await updateRecord("Room", room.name, {
				room_name: form.room_name,
				room_type: form.room_type,
				smoking_policy: form.smoking_policy,
				occupancy_status: form.occupancy_status,
				housekeeping_status: form.housekeeping_status,
				maintenance_status: form.maintenance_status,
				sellable_status: form.sellable_status,
			});
			await setRoomEquipment(room.name, equipment);
			toast.success("Room saved", { description: room.name });
			await load();
		} catch (error) {
			reportError(error, "Could not save the room");
		} finally {
			setSaving(false);
		}
	}

	function addRow() {
		const first = amenities[0];
		if (!first) {
			toast.error("No equipment types yet", { description: "Add some in the Equipment catalog first." });
			return;
		}
		setEquipment((prev) => [...prev, { amenity: first.name, condition: "Working", quantity: 1 }]);
	}

	function updateRow(index: number, patch: Partial<RoomEquipmentItem>) {
		setEquipment((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
	}

	function removeRow(index: number) {
		setEquipment((prev) => prev.filter((_, i) => i !== index));
	}

	if (!roomName) {
		return (
			<AppShell>
				<main className="flex flex-1 items-center justify-center px-6 py-8 text-sm text-muted-foreground">
					No room selected. Open one from Property management.
				</main>
			</AppShell>
		);
	}

	if (loading || !room) {
		return (
			<AppShell>
				<main className="flex flex-1 items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading room…
				</main>
			</AppShell>
		);
	}

	return (
		<AppShell>
			<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6" data-testid="room-workspace">
				<header className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<div className="mb-2 flex items-center gap-2">
							<Button variant="ghost" size="sm" asChild data-testid="back-to-setup">
								<a href="#/setup"><ArrowLeft className="size-4" /> Property management</a>
							</Button>
							<Badge variant="outline">Room</Badge>
						</div>
						<h1 className="text-3xl font-light text-foreground md:text-4xl">
							{room.room_number}
							{room.room_name ? <span className="ml-2 text-xl text-muted-foreground">· {room.room_name}</span> : null}
						</h1>
						<div className="mt-2 flex flex-wrap gap-1">
							<Badge variant="secondary">{form.occupancy_status}</Badge>
							<Badge variant="secondary">{form.housekeeping_status}</Badge>
							<Badge variant={form.maintenance_status === "Available" ? "secondary" : "destructive"}>{form.maintenance_status}</Badge>
							<Badge variant={form.sellable_status === "Sellable" ? "secondary" : "outline"}>{form.sellable_status}</Badge>
						</div>
					</div>
					<Button onClick={save} disabled={saving} data-testid="room-save">
						{saving ? <Loader2 className="size-4 animate-spin" /> : null}
						Save changes
					</Button>
				</header>

				<Tabs defaultValue="overview">
					<TabsList data-testid="room-tabs">
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="equipment">Equipment</TabsTrigger>
						<TabsTrigger value="timeline" data-testid="room-tab-timeline">Timeline</TabsTrigger>
					</TabsList>

					<TabsContent value="overview" className="mt-4 flex flex-col gap-6">
						<RoomInsightsPanel room={room.name} />
						<Card>
							<CardContent className="grid gap-4 py-4 sm:grid-cols-2">
								<Labeled label="Room name">
									<Input
										value={form.room_name}
										onChange={(e) => setForm({ ...form, room_name: e.target.value })}
										placeholder="e.g. Sea View Deluxe"
										data-testid="room-name"
									/>
								</Labeled>
								<LabeledSelect label="Room type" value={form.room_type} onChange={(v) => setForm({ ...form, room_type: v })}>
									{tree?.room_types.map((rt: TreeRoomType) => (
										<SelectItem key={rt.name} value={rt.name}>{rt.room_type_name}</SelectItem>
									))}
								</LabeledSelect>
								<LabeledSelect label="Occupancy" value={form.occupancy_status} onChange={(v) => setForm({ ...form, occupancy_status: v })}>
									{OCCUPANCY.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
								</LabeledSelect>
								<LabeledSelect label="Housekeeping" value={form.housekeeping_status} onChange={(v) => setForm({ ...form, housekeeping_status: v })}>
									{HOUSEKEEPING.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
								</LabeledSelect>
								<LabeledSelect label="Maintenance" value={form.maintenance_status} onChange={(v) => setForm({ ...form, maintenance_status: v })}>
									{MAINTENANCE.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
								</LabeledSelect>
								<LabeledSelect label="Sellable" value={form.sellable_status} onChange={(v) => setForm({ ...form, sellable_status: v })}>
									{SELLABLE.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
								</LabeledSelect>
								<LabeledSelect label="Smoking policy" value={form.smoking_policy} onChange={(v) => setForm({ ...form, smoking_policy: v })}>
									{SMOKING.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
								</LabeledSelect>
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="equipment" className="mt-4">
						<Card>
							<CardContent className="flex flex-col gap-3 py-4" data-testid="room-equipment">
								<div className="flex items-center justify-between">
									<h3 className="text-sm font-semibold">Equipment &amp; condition</h3>
									<Button variant="outline" size="sm" onClick={addRow} data-testid="add-equipment">
										<Plus className="size-4" /> Add
									</Button>
								</div>
								{equipment.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No equipment recorded. Add WiFi, TV, AC, etc. and track each item's condition.
									</p>
								) : (
									equipment.map((row, index) => (
										<div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[1.2fr_1fr_0.8fr_auto]">
											<LabeledSelect
												label="Equipment"
												value={row.amenity}
												onChange={(v) => updateRow(index, { amenity: v })}
											>
												{amenities.map((a) => (
													<SelectItem key={a.name} value={a.name}>{a.amenity_name}</SelectItem>
												))}
											</LabeledSelect>
											<LabeledSelect
												label="Condition"
												value={row.condition}
												onChange={(v) => updateRow(index, { condition: v as EquipmentCondition })}
											>
												{EQUIPMENT_CONDITIONS.map((c) => (
													<SelectItem key={c} value={c}>{c}</SelectItem>
												))}
											</LabeledSelect>
											<Labeled label="Label">
												<Input
													value={row.label ?? ""}
													onChange={(e) => updateRow(index, { label: e.target.value })}
													placeholder="model / tag"
												/>
											</Labeled>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => removeRow(index)}
												aria-label="Remove equipment"
											>
												<Trash2 className="size-4 text-destructive" />
											</Button>
										</div>
									))
								)}
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="timeline" className="mt-4">
						<EngagementTimeline events={events} />
					</TabsContent>
				</Tabs>
			</main>
		</AppShell>
	);
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			{children}
		</div>
	);
}

function LabeledSelect({
	label,
	value,
	onChange,
	children,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>{children}</SelectContent>
			</Select>
		</div>
	);
}
