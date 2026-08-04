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
import { ArrowLeft, Loader2, Plus, Trash2, Wrench } from "lucide-react";
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
import { PhotoField } from "@/components/property/photo-field";
import { ReportIssueSheet } from "@/components/maintenance/report-issue-sheet";
import { getRoomTimeline, type TimelineEvent } from "@/lib/timeline-api";
import { listRoomStatusEvents, type RoomStatusEvent } from "@/lib/room-status-events-api";
import {
	EQUIPMENT_CONDITIONS,
	FolioApiError,
	getPropertyTree,
	getRoomConnections,
	getRoomEquipment,
	listAmenities,
	listErpnextAssets,
	listSetupOptions,
	setRoomConnections,
	setRoomEquipment,
	updateRecord,
	type ErpnextAsset,
	type Amenity,
	type EquipmentCondition,
	type PropertyTree,
	type RoomConnection,
	type RoomConnectionType,
	type RoomEquipmentItem,
	type TreeRoom,
	type TreeRoomType,
} from "@/lib/setup-api";

const CONNECTION_TYPES: RoomConnectionType[] = ["Connecting", "Adjacent", "Nearby"];

const OCCUPANCY = ["Vacant", "Reserved", "Occupied", "Due In", "Due Out", "Checked Out", "Hold"];
const HOUSEKEEPING = ["Clean", "Dirty", "In Progress", "Inspected", "Pickup", "Turndown Required", "Out of Service Cleaning"];
const MAINTENANCE = ["Available", "Maintenance Requested", "Under Maintenance", "Out of Order", "Out of Service", "Preventive Maintenance"];
const SELLABLE = ["Sellable", "Not Sellable", "Restricted", "Temporarily Blocked"];
const SMOKING = ["Non-Smoking", "Smoking", "Flexible"];

function formatWhen(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", {
		day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
	}).format(d);
}

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

export default function RoomWorkspace({ roomName }: { roomName: string | null }) {
	const [room, setRoom] = useState<TreeRoom | null>(null);
	const [tree, setTree] = useState<PropertyTree | null>(null);
	const [amenities, setAmenities] = useState<Amenity[]>([]);
	const [equipment, setEquipment] = useState<RoomEquipmentItem[]>([]);
	const [events, setEvents] = useState<TimelineEvent[]>([]);
	const [statusEvents, setStatusEvents] = useState<RoomStatusEvent[]>([]);
	const [connections, setConnections] = useState<RoomConnection[]>([]);
	const [savingConnections, setSavingConnections] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [statusReason, setStatusReason] = useState("");
	const [reportIssueOpen, setReportIssueOpen] = useState(false);
	const [assets, setAssets] = useState<ErpnextAsset[]>([]);
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
			const [am, eq, tl, conn, hist] = await Promise.all([
				listAmenities(),
				getRoomEquipment(foundRoom.name).catch(() => ({ items: [] as RoomEquipmentItem[] })),
				getRoomTimeline(foundRoom.name).catch(() => ({ target: { doctype: "Room", name: foundRoom.name }, events: [] as TimelineEvent[] })),
				getRoomConnections(foundRoom.name).catch(() => ({ room: foundRoom.name, connections: [] as RoomConnection[] })),
				listRoomStatusEvents(foundRoom.name, 1, 50).catch(() => ({ room: foundRoom.name, total: 0, page: 1, page_size: 50, events: [] as RoomStatusEvent[] })),
			]);
			setAmenities(am.amenities);
			setEquipment(eq.items);
			setEvents(tl.events);
			setConnections(conn.connections);
			setStatusEvents(hist.events);
			listErpnextAssets().then((a) => setAssets(a.assets)).catch(() => setAssets([]));
		} catch (error) {
			reportError(error, "Could not load room");
		} finally {
			setLoading(false);
		}
	}, [roomName]);

	useEffect(() => { load(); }, [load]);

	async function save() {
		if (!room) return;
		// The payload always includes all four status fields, so the backend
		// always requires a reason (setup/management.py:update_record — it
		// checks field presence, not whether the value actually changed).
		if (!statusReason.trim()) {
			toast.error("Reason required", { description: "Explain the status change before saving." });
			return;
		}
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
				reason: statusReason.trim(),
			});
			await setRoomEquipment(room.name, equipment);
			toast.success("Room saved", { description: room.name });
			setStatusReason("");
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

	function addConnection() {
		const candidate = tree?.rooms.find((r) => r.name !== room?.name && !connections.some((c) => c.connected_room === r.name));
		if (!candidate) {
			toast.error("No rooms available", { description: "Every other room is already connected, or there are no other rooms." });
			return;
		}
		setConnections((prev) => [...prev, { connected_room: candidate.name, connection_type: "Connecting", notes: "" }]);
	}

	function updateConnection(index: number, patch: Partial<RoomConnection>) {
		setConnections((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
	}

	function removeConnection(index: number) {
		setConnections((prev) => prev.filter((_, i) => i !== index));
	}

	async function saveConnections() {
		if (!room) return;
		setSavingConnections(true);
		try {
			await setRoomConnections(room.name, connections);
			toast.success("Connections saved", { description: room.name });
			await load();
		} catch (error) {
			reportError(error, "Could not save room connections");
		} finally {
			setSavingConnections(false);
		}
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
			<main className="flex flex-1 flex-col gap-6  px-4 py-6 lg:px-6" data-testid="room-workspace">
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
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							onClick={() => setReportIssueOpen(true)}
							data-testid="room-report-issue"
						>
							<Wrench className="mr-1.5 size-4" /> Report issue
						</Button>
						<Button onClick={save} disabled={saving} data-testid="room-save">
							{saving ? <Loader2 className="size-4 animate-spin" /> : null}
							Save changes
						</Button>
					</div>
				</header>

				<Tabs defaultValue="overview">
					<TabsList data-testid="room-tabs">
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="equipment">Equipment</TabsTrigger>
						<TabsTrigger value="connections" data-testid="room-tab-connections">Connections</TabsTrigger>
						<TabsTrigger value="history" data-testid="room-tab-history">Status history</TabsTrigger>
						<TabsTrigger value="timeline" data-testid="room-tab-timeline">Timeline</TabsTrigger>
					</TabsList>

					<TabsContent value="overview" className="mt-4 flex flex-col gap-6">
						<RoomInsightsPanel room={room.name} />
						<Card>
							<CardContent className="grid gap-4 py-4 sm:grid-cols-2">
								<div className="sm:col-span-2">
									<Label className="mb-1.5 block text-xs text-muted-foreground">Room photo</Label>
									<PhotoField
										image={room.image}
										label={room.room_number}
										onUploaded={async (fileUrl) => {
											await updateRecord("Room", room.name, { image: fileUrl });
											await load();
										}}
									/>
								</div>
								<div className="sm:col-span-2">
									<LabeledSelect
										label="Linked ERPNext Asset (fixed-asset tracking)"
										value={room.room_asset ?? "__none__"}
										onChange={async (v) => {
											await updateRecord("Room", room.name, { room_asset: v === "__none__" ? "" : v });
											toast.success("Asset link updated", { description: room.room_number });
											await load();
										}}
									>
										<SelectItem value="__none__">Not linked</SelectItem>
										{room.room_asset && !assets.some((a) => a.name === room.room_asset) ? (
											<SelectItem value={room.room_asset}>{room.room_asset} (current)</SelectItem>
										) : null}
										{assets.map((a) => (
											<SelectItem key={a.name} value={a.name}>
												{a.asset_name}{a.linked_room && a.linked_room !== room.name ? ` · on ${a.linked_room}` : ""}
											</SelectItem>
										))}
									</LabeledSelect>
									{assets.length === 0 ? (
										<p className="mt-1 text-xs text-muted-foreground">No ERPNext assets exist yet — create them via procurement (Purchase Receipt → Asset), then link here.</p>
									) : null}
								</div>
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
								<div className="sm:col-span-2">
									<Labeled label="Reason for this change (required — recorded on the status audit trail)">
										<Input
											value={statusReason}
											onChange={(e) => setStatusReason(e.target.value)}
											placeholder="e.g. Guest requested late checkout, room reset after departure…"
											data-testid="room-status-reason"
										/>
									</Labeled>
								</div>
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

					<TabsContent value="connections" className="mt-4">
						<Card>
							<CardContent className="flex flex-col gap-3 py-4" data-testid="room-connections">
								<div className="flex items-center justify-between">
									<h3 className="text-sm font-semibold">Connecting rooms</h3>
									<Button variant="outline" size="sm" onClick={addConnection} data-testid="add-connection">
										<Plus className="size-4" /> Add
									</Button>
								</div>
								{connections.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No connections recorded. Link this room to adjoining or nearby rooms so front desk can allocate connecting/adjacent stays.
									</p>
								) : (
									connections.map((row, index) => (
										<div key={index} className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-end gap-2">
											<LabeledSelect
												label="Room"
												value={row.connected_room}
												onChange={(v) => updateConnection(index, { connected_room: v })}
											>
												{tree?.rooms
													.filter((r) => r.name !== room.name)
													.map((r) => (
														<SelectItem key={r.name} value={r.name}>
															{r.room_number}{r.room_name ? ` · ${r.room_name}` : ""}
														</SelectItem>
													))}
											</LabeledSelect>
											<LabeledSelect
												label="Type"
												value={row.connection_type}
												onChange={(v) => updateConnection(index, { connection_type: v as RoomConnectionType })}
											>
												{CONNECTION_TYPES.map((c) => (
													<SelectItem key={c} value={c}>{c}</SelectItem>
												))}
											</LabeledSelect>
											<Labeled label="Notes">
												<Input
													value={row.notes ?? ""}
													onChange={(e) => updateConnection(index, { notes: e.target.value })}
													placeholder="optional"
												/>
											</Labeled>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => removeConnection(index)}
												aria-label="Remove connection"
											>
												<Trash2 className="size-4 text-destructive" />
											</Button>
										</div>
									))
								)}
								<div className="flex justify-end">
									<Button onClick={saveConnections} disabled={savingConnections} data-testid="save-connections">
										{savingConnections ? <Loader2 className="size-4 animate-spin" /> : null}
										Save connections
									</Button>
								</div>
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="history" className="mt-4">
						<Card>
							<CardContent className="flex flex-col gap-3 py-4" data-testid="room-status-history">
								<h3 className="text-sm font-semibold">Status change history</h3>
								{statusEvents.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No status changes recorded yet. Every occupancy, housekeeping, maintenance, or sellable change is logged here with who changed it and why.
									</p>
								) : (
									<div className="flex flex-col divide-y">
										{statusEvents.map((ev) => (
											<div key={ev.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
												<div className="flex flex-col">
													<span className="text-sm font-medium">
														{ev.event_type}: {ev.previous_value || "—"} → {ev.new_value}
													</span>
													{ev.reason ? (
														<span className="text-xs text-muted-foreground">{ev.reason}</span>
													) : null}
												</div>
												<div className="text-right text-xs text-muted-foreground">
													<div>{ev.changed_by}</div>
													<div>{formatWhen(ev.changed_at)}</div>
												</div>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="timeline" className="mt-4">
						<EngagementTimeline events={events} />
					</TabsContent>
				</Tabs>
			</main>

			<ReportIssueSheet
				open={reportIssueOpen}
				onOpenChange={setReportIssueOpen}
				resortProperty={tree?.resort_property ?? "REEZORT"}
				room={room.name}
				onCreated={() => {
					setReportIssueOpen(false);
				}}
			/>
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
