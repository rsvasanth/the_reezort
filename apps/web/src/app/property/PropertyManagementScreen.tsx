/**
 * Property Management console — full CRUD over the property hierarchy plus
 * per-room equipment tracking, inventory blocks, settings, and service locations.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Field } from "@/components/workspace/field";
import { CalendarDays, Loader2, Plus, Pencil, Power, Trash2, Wand2, X } from "lucide-react";
import { toast } from "sonner";

import PropertySetupScreen from "@/app/setup/PropertySetupScreen";
import { PricingTab } from "@/app/property/PricingTab";
import { RoomThumb } from "@/components/property/room-thumb";
import { PhotoField } from "@/components/property/photo-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
	DialogClose,
} from "@/components/ui/dialog";
import {
	FolioApiError,
	createBuilding,
	createFloor,
	createRoomType,
	createRoomsBulk,
	createAmenity,
	deleteRecord,
	getPropertyTree,
	listAmenities,
	listSetupOptions,
	setActive,
	updateRecord,
	type Amenity,
	type ManagedDoctype,
	type PropertyOption,
	type PropertyTree,
	type TreeRoomType,
} from "@/lib/setup-api";
import {
	listRoomBlocks,
	createRoomBlock,
	releaseRoomBlock,
	type BlockType,
	type BlockScope,
	type BlockStatus,
	type RoomInventoryBlock,
} from "@/lib/room-blocks-api";
import {
	getPropertySettings,
	updatePropertySettings,
	type PropertySettings,
	type RoomIdentifierUniqueness,
	type HardBlockOverlapPolicy,
} from "@/lib/property-settings-api";
import {
	listServiceLocations,
	createServiceLocation,
	updateServiceLocation,
	setServiceLocationActive,
	deleteServiceLocation,
	type ServiceLocation,
	type ServiceLocationType,
} from "@/lib/service-location-api";
import {
	getRoomTypeInventoryView,
	type RoomTypeInventoryRow,
} from "@/lib/room-inventory-view-api";
import {
	listEventSpaces,
	createEventSpace,
	setEventSpaceActive,
	listActivityAreas,
	createActivityArea,
	setActivityAreaActive,
	listSpaRooms,
	createSpaRoom,
	setSpaRoomActive,
	type EventSpace,
	type ActivityArea,
	type ActivityAreaType,
	type SpaRoom,
} from "@/lib/spaces-api";

function rupees(n?: number): string {
	return `₹${Number(n ?? 0).toLocaleString("en-IN")}`;
}

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function generateRoomNumbers(start: string, count: number): string[] {
	const match = start.trim().match(/^(\D*)(\d+)$/);
	if (!match) return Array.from({ length: count }, (_, i) => (i === 0 ? start.trim() : `${start.trim()}-${i + 1}`));
	const [, prefix, digits] = match;
	const base = parseInt(digits, 10);
	return Array.from({ length: count }, (_, i) => `${prefix}${String(base + i).padStart(digits.length, "0")}`);
}

export default function PropertyManagementScreen() {
	const [mode, setMode] = useState<"manage" | "wizard">("manage");
	const [properties, setProperties] = useState<PropertyOption[]>([]);
	const [selected, setSelected] = useState<string>("");
	const [tree, setTree] = useState<PropertyTree | null>(null);
	const [amenities, setAmenities] = useState<Amenity[]>([]);
	const [loading, setLoading] = useState(true);

	const loadProperties = useCallback(async () => {
		try {
			const opts = await listSetupOptions();
			setProperties(opts.properties);
			setSelected((prev) => prev || opts.properties[0]?.name || "");
		} catch (error) {
			reportError(error, "Could not load properties");
		} finally {
			setLoading(false);
		}
	}, []);

	const reloadTree = useCallback(async () => {
		if (!selected) {
			setTree(null);
			return;
		}
		try {
			const [t, a] = await Promise.all([getPropertyTree(selected), listAmenities()]);
			setTree(t);
			setAmenities(a.amenities);
		} catch (error) {
			reportError(error, "Could not load property");
		}
	}, [selected]);

	useEffect(() => {
		loadProperties();
	}, [loadProperties]);

	useEffect(() => {
		reloadTree();
	}, [reloadTree]);

	async function mutate(fn: () => Promise<unknown>, success: string) {
		try {
			await fn();
			toast.success(success);
			await reloadTree();
		} catch (error) {
			reportError(error, "Action failed");
		}
	}

	if (mode === "wizard") {
		return (
			<div className="flex flex-1 flex-col">
				<div className="border-b px-4 py-3 lg:px-6">
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setMode("manage");
							loadProperties();
						}}
					>
						← Back to management
					</Button>
				</div>
				<PropertySetupScreen />
			</div>
		);
	}

	return (
		<main className="flex flex-1 flex-col gap-6  px-4 py-6 lg:px-6" data-testid="property-mgmt">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<Badge variant="outline" className="mb-2">Property management</Badge>
					<h1 className="text-3xl font-light text-foreground md:text-4xl">Properties &amp; rooms</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Create, edit, deactivate, and track room equipment — without the ERPNext desk.
					</p>
				</div>
				<Button onClick={() => setMode("wizard")} data-testid="guided-onboard">
					<Wand2 className="size-4" /> Guided onboard
				</Button>
			</header>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : properties.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-start gap-3 py-8">
						<p className="text-sm text-muted-foreground">No properties yet.</p>
						<Button onClick={() => setMode("wizard")}>
							<Wand2 className="size-4" /> Onboard your first property
						</Button>
					</CardContent>
				</Card>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-3">
						<Label className="text-sm text-muted-foreground">Property</Label>
						<Select value={selected} onValueChange={setSelected}>
							<SelectTrigger className="w-72" data-testid="property-select">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{properties.map((p) => (
									<SelectItem key={p.name} value={p.name}>
										{p.property_name} ({p.name})
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{tree ? (
							<div className="flex gap-2 text-xs text-muted-foreground">
								<Badge variant="secondary">{tree.counts.buildings} buildings</Badge>
								<Badge variant="secondary">{tree.counts.floors} floors</Badge>
								<Badge variant="secondary">{tree.counts.room_types} types</Badge>
								<Badge variant="secondary">{tree.counts.rooms} rooms</Badge>
							</div>
						) : null}
					</div>

					{tree ? (
						<div className="mt-3">
							<Label className="mb-1.5 block text-xs text-muted-foreground">Property photo</Label>
							<PhotoField
								image={tree.property_image}
								label="Resort property"
								onUploaded={(fileUrl) => mutate(() => updateRecord("Resort Property", tree.resort_property, { image: fileUrl }), "Property photo updated")}
							/>
						</div>
					) : null}

					{tree ? (
						<Tabs defaultValue="rooms">
							<TabsList>
								<TabsTrigger value="rooms" data-testid="tab-rooms">Rooms</TabsTrigger>
								<TabsTrigger value="structure">Structure</TabsTrigger>
								<TabsTrigger value="types">Room types</TabsTrigger>
								<TabsTrigger value="equipment">Equipment catalog</TabsTrigger>
								<TabsTrigger value="pricing" data-testid="tab-pricing">Pricing</TabsTrigger>
								<TabsTrigger value="inventory" data-testid="tab-inventory">Inventory</TabsTrigger>
								<TabsTrigger value="blocks" data-testid="tab-blocks">Blocks</TabsTrigger>
								<TabsTrigger value="locations" data-testid="tab-locations">Locations</TabsTrigger>
								<TabsTrigger value="spaces" data-testid="tab-spaces">Spaces</TabsTrigger>
								<TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
							</TabsList>

							<TabsContent value="rooms" className="mt-4">
								<RoomsTab tree={tree} onMutate={mutate} />
							</TabsContent>
							<TabsContent value="structure" className="mt-4">
								<StructureTab tree={tree} onMutate={mutate} />
							</TabsContent>
							<TabsContent value="types" className="mt-4">
								<RoomTypesTab tree={tree} onMutate={mutate} />
							</TabsContent>
							<TabsContent value="equipment" className="mt-4">
								<EquipmentTab amenities={amenities} onMutate={mutate} />
							</TabsContent>
							<TabsContent value="pricing" className="mt-4">
								<PricingTab resortProperty={tree.resort_property} />
							</TabsContent>
							<TabsContent value="inventory" className="mt-4">
								<InventoryTab resortProperty={tree.resort_property} />
							</TabsContent>
							<TabsContent value="blocks" className="mt-4">
								<BlocksTab
									resortProperty={tree.resort_property}
									rooms={tree.rooms}
									roomTypes={tree.room_types}
								/>
							</TabsContent>
							<TabsContent value="locations" className="mt-4">
								<LocationsTab
									resortProperty={tree.resort_property}
									buildings={tree.buildings}
									floors={tree.floors}
								/>
							</TabsContent>
							<TabsContent value="spaces" className="mt-4">
								<SpacesTab
									resortProperty={tree.resort_property}
									buildings={tree.buildings}
									floors={tree.floors}
								/>
							</TabsContent>
							<TabsContent value="settings" className="mt-4">
								<PropertySettingsTab resortProperty={tree.resort_property} />
							</TabsContent>
						</Tabs>
					) : null}
				</>
			)}
		</main>
	);
}

// ---------- Shared helpers ----------

type MutateFn = (fn: () => Promise<unknown>, success: string) => Promise<void>;

function StatusBadge({ value, danger }: { value: string; danger?: boolean }) {
	return <Badge variant={danger ? "destructive" : "secondary"}>{value}</Badge>;
}

function BlockStatusBadge({ status }: { status: BlockStatus }) {
	const variant =
		status === "Active" ? "destructive" : status === "Released" ? "secondary" : "outline";
	return <Badge variant={variant}>{status}</Badge>;
}

function Picker({
	label,
	value,
	onChange,
	options,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	options: { value: string; label: string }[];
}) {
	return (
		<div className="flex flex-col gap-1.5">
			{label ? <Label className="text-xs text-muted-foreground">{label}</Label> : null}
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

// ---------- Existing tabs (unchanged) ----------

function RoomsTab({ tree, onMutate }: { tree: PropertyTree; onMutate: MutateFn }) {
	const [buildingFilter, setBuildingFilter] = useState("all");
	const [add, setAdd] = useState({ building: "", floor: "", room_type: "", start: "101", count: "10" });

	const rooms = useMemo(
		() => (buildingFilter === "all" ? tree.rooms : tree.rooms.filter((r) => r.building === buildingFilter)),
		[tree.rooms, buildingFilter]
	);
	const floorsForBuilding = tree.floors.filter((f) => f.building === add.building);
	const preview = generateRoomNumbers(add.start, Math.max(0, Math.min(200, parseInt(add.count, 10) || 0)));

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardContent className="grid items-end gap-3 py-4 sm:grid-cols-6">
					<Picker label="Building" value={add.building} onChange={(v) => setAdd({ ...add, building: v, floor: "" })} options={tree.buildings.map((b) => ({ value: b.name, label: b.building_name }))} />
					<Picker label="Floor" value={add.floor} onChange={(v) => setAdd({ ...add, floor: v })} options={floorsForBuilding.map((f) => ({ value: f.name, label: f.floor_label }))} />
					<Picker label="Room type" value={add.room_type} onChange={(v) => setAdd({ ...add, room_type: v })} options={tree.room_types.map((rt) => ({ value: rt.name, label: rt.room_type_name }))} />
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs text-muted-foreground">Start #</Label>
						<Input value={add.start} onChange={(e) => setAdd({ ...add, start: e.target.value })} data-testid="add-start" />
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs text-muted-foreground">Count</Label>
						<Input type="number" value={add.count} onChange={(e) => setAdd({ ...add, count: e.target.value })} data-testid="add-count" />
					</div>
					<Button
						disabled={!add.building || !add.floor || !add.room_type}
						data-testid="add-rooms"
						onClick={() =>
							onMutate(
								() =>
									createRoomsBulk({
										resort_property: tree.resort_property,
										building: add.building,
										floor: add.floor,
										room_type: add.room_type,
										room_numbers: preview,
									}),
								`Added ${preview.length} room(s)`
							)
						}
					>
						<Plus className="size-4" /> Add {preview.length}
					</Button>
				</CardContent>
			</Card>

			<div className="flex items-center gap-3">
				<Picker label="" value={buildingFilter} onChange={setBuildingFilter} options={[{ value: "all", label: "All buildings" }, ...tree.buildings.map((b) => ({ value: b.name, label: b.building_name }))]} />
				<span className="text-sm text-muted-foreground">{rooms.length} rooms</span>
			</div>

			<div className="rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Room</TableHead>
							<TableHead>Type</TableHead>
							<TableHead>Occupancy</TableHead>
							<TableHead>Housekeeping</TableHead>
							<TableHead>Maintenance</TableHead>
							<TableHead>State</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rooms.map((r) => (
							<TableRow
								key={r.name}
								data-testid={`mgmt-room-${r.room_number}`}
								className={`cursor-pointer hover:bg-accent/40 ${r.is_active ? "" : "opacity-50"}`}
								onClick={() => { window.location.hash = `#/room/${encodeURIComponent(r.name)}`; }}
							>
								<TableCell className="font-medium">
									<div className="flex items-center gap-3">
										<RoomThumb image={r.image} label={r.room_number} size={40} />
										<div>
											{r.room_number}
											{r.room_name ? <span className="block text-xs text-muted-foreground">{r.room_name}</span> : null}
										</div>
									</div>
								</TableCell>
								<TableCell className="text-sm">{r.room_type}</TableCell>
								<TableCell><StatusBadge value={r.occupancy_status} /></TableCell>
								<TableCell><StatusBadge value={r.housekeeping_status} danger={r.housekeeping_status === "Dirty"} /></TableCell>
								<TableCell><StatusBadge value={r.maintenance_status} danger={r.maintenance_status === "Out of Order"} /></TableCell>
								<TableCell>{r.is_active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
								<TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
									<div className="flex justify-end gap-1">
										<Button variant="ghost" size="icon" asChild aria-label="Open room" data-testid={`edit-${r.room_number}`}>
											<a href={`#/room/${encodeURIComponent(r.name)}`}>
												<Pencil className="size-4" />
											</a>
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label="Toggle active"
											onClick={() => onMutate(() => setActive("Room", r.name, !r.is_active), r.is_active ? "Room deactivated" : "Room activated")}
										>
											<Power className={r.is_active ? "size-4" : "size-4 text-muted-foreground"} />
										</Button>
										<DeleteButton doctype="Room" name={r.name} onMutate={onMutate} />
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function StructureTab({ tree, onMutate }: { tree: PropertyTree; onMutate: MutateFn }) {
	const [b, setB] = useState({ building_name: "", building_code: "" });
	const [f, setF] = useState({ building: "", floor_label: "", floor_code: "" });
	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<Card>
				<CardContent className="flex flex-col gap-3 py-4">
					<h3 className="text-sm font-semibold">Buildings</h3>
					{tree.buildings.map((bld) => (
						<div key={bld.name} className="flex items-center justify-between text-sm">
							<span className={bld.is_active ? "" : "text-muted-foreground line-through"}>{bld.building_name} <span className="text-muted-foreground">({bld.building_code})</span></span>
							<div className="flex gap-1">
								<Button variant="ghost" size="icon" aria-label="Toggle active" onClick={() => onMutate(() => setActive("Resort Building", bld.name, !bld.is_active), "Updated")}><Power className="size-4" /></Button>
								<DeleteButton doctype="Resort Building" name={bld.name} onMutate={onMutate} />
							</div>
						</div>
					))}
					<div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
						<Field label="Name"><Input value={b.building_name} onChange={(e) => setB({ ...b, building_name: e.target.value })} placeholder="Garden Wing" /></Field>
						<Field label="Code"><Input value={b.building_code} onChange={(e) => setB({ ...b, building_code: e.target.value })} placeholder="GW" /></Field>
						<Button disabled={!b.building_name || !b.building_code} onClick={() => onMutate(() => createBuilding({ resort_property: tree.resort_property, ...b }), "Building added").then(() => setB({ building_name: "", building_code: "" }))}><Plus className="size-4" /></Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="flex flex-col gap-3 py-4">
					<h3 className="text-sm font-semibold">Floors</h3>
					{tree.floors.map((flr) => (
						<div key={flr.name} className="flex items-center justify-between text-sm">
							<span className={flr.is_active ? "" : "text-muted-foreground line-through"}>{flr.floor_label} <span className="text-muted-foreground">({flr.building})</span></span>
							<div className="flex gap-1">
								<Button variant="ghost" size="icon" aria-label="Toggle active" onClick={() => onMutate(() => setActive("Resort Floor", flr.name, !flr.is_active), "Updated")}><Power className="size-4" /></Button>
								<DeleteButton doctype="Resort Floor" name={flr.name} onMutate={onMutate} />
							</div>
						</div>
					))}
					<div className="grid grid-cols-[1.2fr_1fr_0.8fr_auto] items-end gap-2">
						<Picker label="Building" value={f.building} onChange={(v) => setF({ ...f, building: v })} options={tree.buildings.map((x) => ({ value: x.name, label: x.building_name }))} />
						<Field label="Label"><Input value={f.floor_label} onChange={(e) => setF({ ...f, floor_label: e.target.value })} placeholder="Floor 2" /></Field>
						<Field label="Code"><Input value={f.floor_code} onChange={(e) => setF({ ...f, floor_code: e.target.value })} placeholder="2" /></Field>
						<Button disabled={!f.building || !f.floor_label || !f.floor_code} onClick={() => onMutate(() => createFloor({ resort_property: tree.resort_property, ...f }), "Floor added").then(() => setF({ building: "", floor_label: "", floor_code: "" }))}><Plus className="size-4" /></Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function RoomTypeRow({ t, onMutate }: { t: TreeRoomType; onMutate: MutateFn }) {
	const [rate, setRate] = useState(String(t.nightly_rate ?? ""));
	const dirty = rate !== String(t.nightly_rate ?? "");
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
			<div className="flex items-center gap-3">
				<PhotoField
					image={t.image}
					label={t.room_type_name}
					onUploaded={(fileUrl) => onMutate(() => updateRecord("Room Type", t.name, { image: fileUrl }), "Photo updated")}
				/>
				<span className={t.is_active ? "" : "text-muted-foreground line-through"}>
					{t.room_type_name} <span className="text-muted-foreground">({t.room_type_code}, max {t.max_occupancy})</span>
				</span>
			</div>
			<div className="flex items-center gap-1">
				<span className="text-xs text-muted-foreground">₹/night</span>
				<Input
					className="h-8 w-28"
					type="number"
					min="0"
					value={rate}
					onChange={(e) => setRate(e.target.value)}
					data-testid={`rate-${t.room_type_code}`}
				/>
				<Button
					variant="outline"
					size="sm"
					disabled={!dirty}
					onClick={() => onMutate(() => updateRecord("Room Type", t.name, { nightly_rate: parseFloat(rate) || 0 }), "Rate updated")}
				>
					Set
				</Button>
				<Button variant="ghost" size="icon" aria-label="Toggle active" onClick={() => onMutate(() => setActive("Room Type", t.name, !t.is_active), "Updated")}><Power className="size-4" /></Button>
				<DeleteButton doctype="Room Type" name={t.name} onMutate={onMutate} />
			</div>
		</div>
	);
}

function RoomTypesTab({ tree, onMutate }: { tree: PropertyTree; onMutate: MutateFn }) {
	const [rt, setRt] = useState({ room_type_name: "", room_type_code: "", standard_adults: "2", max_occupancy: "2", nightly_rate: "" });
	return (
		<Card>
			<CardContent className="flex flex-col gap-3 py-4">
				{tree.room_types.map((t) => (
					<RoomTypeRow key={t.name} t={t} onMutate={onMutate} />
				))}
				<div className="grid grid-cols-[1.3fr_0.9fr_0.6fr_0.6fr_0.9fr_auto] items-end gap-2">
					<Field label="Name"><Input value={rt.room_type_name} onChange={(e) => setRt({ ...rt, room_type_name: e.target.value })} placeholder="Signature Arch Villa" /></Field>
					<Field label="Code"><Input value={rt.room_type_code} onChange={(e) => setRt({ ...rt, room_type_code: e.target.value })} placeholder="SAV" /></Field>
					<Field label="Adults"><Input type="number" value={rt.standard_adults} onChange={(e) => setRt({ ...rt, standard_adults: e.target.value })} /></Field>
					<Field label="Max"><Input type="number" value={rt.max_occupancy} onChange={(e) => setRt({ ...rt, max_occupancy: e.target.value })} /></Field>
					<Field label="₹/night"><Input type="number" min="0" value={rt.nightly_rate} onChange={(e) => setRt({ ...rt, nightly_rate: e.target.value })} placeholder="18000" /></Field>
					<Button disabled={!rt.room_type_name || !rt.room_type_code} onClick={() => onMutate(() => createRoomType({ resort_property: tree.resort_property, room_type_name: rt.room_type_name, room_type_code: rt.room_type_code, standard_adults: parseInt(rt.standard_adults, 10) || 2, max_occupancy: parseInt(rt.max_occupancy, 10) || 2, nightly_rate: parseFloat(rt.nightly_rate) || 0 }), "Room type added").then(() => setRt({ room_type_name: "", room_type_code: "", standard_adults: "2", max_occupancy: "2", nightly_rate: "" }))}><Plus className="size-4" /></Button>
				</div>
			</CardContent>
		</Card>
	);
}

function EquipmentTab({ amenities, onMutate }: { amenities: Amenity[]; onMutate: MutateFn }) {
	const [a, setA] = useState({ amenity_name: "", amenity_code: "" });
	return (
		<Card>
			<CardContent className="flex flex-col gap-3 py-4">
				<h3 className="text-sm font-semibold">Equipment catalog (WiFi, TV, AC, …)</h3>
				<div className="flex flex-wrap gap-2">
					{amenities.map((am) => (
						<Badge key={am.name} variant="secondary" data-testid={`amenity-${am.amenity_code}`}>{am.amenity_name}</Badge>
					))}
					{amenities.length === 0 ? <span className="text-sm text-muted-foreground">No equipment types yet.</span> : null}
				</div>
				<div className="grid grid-cols-[1.4fr_1fr_auto] items-end gap-2">
					<Field label="Name"><Input value={a.amenity_name} onChange={(e) => setA({ ...a, amenity_name: e.target.value })} placeholder="Air Conditioner" data-testid="amenity-name" /></Field>
					<Field label="Code"><Input value={a.amenity_code} onChange={(e) => setA({ ...a, amenity_code: e.target.value })} placeholder="AC" data-testid="amenity-code" /></Field>
					<Button disabled={!a.amenity_name || !a.amenity_code} data-testid="add-amenity" onClick={() => onMutate(() => createAmenity(a), "Equipment type added").then(() => setA({ amenity_name: "", amenity_code: "" }))}><Plus className="size-4" /></Button>
				</div>
			</CardContent>
		</Card>
	);
}

function DeleteButton({ doctype, name, onMutate }: { doctype: ManagedDoctype; name: string; onMutate: MutateFn }) {
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label="Delete"
			onClick={() => onMutate(() => deleteRecord(doctype, name), "Deleted")}
		>
			<Trash2 className="size-4 text-destructive" />
		</Button>
	);
}

// ---------- Blocks tab ----------

const BLOCK_TYPES: BlockType[] = ["Maintenance", "VIP Hold", "Owner Hold", "Group Hold", "Operational", "Other"];
const BLOCK_SCOPES: BlockScope[] = ["Room", "Room Type"];

function BlocksTab({
	resortProperty,
	rooms,
	roomTypes,
}: {
	resortProperty: string;
	rooms: { name: string; room_number: string }[];
	roomTypes: { name: string; room_type_name: string }[];
}) {
	const [blocks, setBlocks] = useState<RoomInventoryBlock[]>([]);
	const [loading, setLoading] = useState(true);
	const [statusFilter, setStatusFilter] = useState<BlockStatus | "All">("Active");
	const [createOpen, setCreateOpen] = useState(false);
	const [form, setForm] = useState({
		block_type: "Maintenance" as BlockType,
		scope: "Room" as BlockScope,
		room: "",
		room_type: "",
		start_date: "",
		end_date: "",
		reason: "",
		is_hard_block: true,
	});
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const result = await listRoomBlocks({
				property: resortProperty,
				status: statusFilter === "All" ? ["Active", "Released", "Cancelled"] : [statusFilter],
				page_length: 100,
			});
			setBlocks(result.blocks);
		} catch (error) {
			reportError(error, "Could not load inventory blocks");
		} finally {
			setLoading(false);
		}
	}, [resortProperty, statusFilter]);

	useEffect(() => { load(); }, [load]);

	async function handleCreate() {
		setSaving(true);
		try {
			await createRoomBlock({
				property: resortProperty,
				scope: form.scope,
				block_type: form.block_type,
				room: form.scope === "Room" ? form.room : undefined,
				room_type: form.scope === "Room Type" ? form.room_type : undefined,
				start_date: form.start_date,
				end_date: form.end_date,
				reason: form.reason,
				is_hard_block: form.is_hard_block,
			});
			toast.success("Block created");
			setCreateOpen(false);
			setForm({ block_type: "Maintenance", scope: "Room", room: "", room_type: "", start_date: "", end_date: "", reason: "", is_hard_block: true });
			await load();
		} catch (error) {
			reportError(error, "Could not create block");
		} finally {
			setSaving(false);
		}
	}

	async function handleRelease(block: RoomInventoryBlock) {
		try {
			await releaseRoomBlock(block.name);
			toast.success("Block released");
			await load();
		} catch (error) {
			reportError(error, "Could not release block");
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Picker
						label=""
						value={statusFilter}
						onChange={(v) => setStatusFilter(v as BlockStatus | "All")}
						options={[
							{ value: "All", label: "All statuses" },
							{ value: "Active", label: "Active" },
							{ value: "Released", label: "Released" },
							{ value: "Cancelled", label: "Cancelled" },
						]}
					/>
					{loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
						<span className="text-sm text-muted-foreground">{blocks.length} block(s)</span>
					)}
				</div>
				<Button size="sm" onClick={() => setCreateOpen(true)} data-testid="create-block">
					<Plus className="size-4" /> Create block
				</Button>
			</div>

			{!loading && blocks.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						No inventory blocks found for the selected filter.
					</CardContent>
				</Card>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>ID</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Scope</TableHead>
								<TableHead>Target</TableHead>
								<TableHead>Dates</TableHead>
								<TableHead>Reason</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{blocks.map((b) => (
								<TableRow key={b.name}>
									<TableCell className="text-xs font-mono">{b.name}</TableCell>
									<TableCell><Badge variant="outline">{b.block_type}</Badge></TableCell>
									<TableCell className="text-sm">{b.scope}</TableCell>
									<TableCell className="text-sm">{b.room ?? b.room_type ?? "—"}</TableCell>
									<TableCell className="text-xs">
										<div className="flex items-center gap-1">
											<CalendarDays className="size-3 text-muted-foreground" />
											{b.start_date} → {b.end_date}
										</div>
									</TableCell>
									<TableCell className="max-w-[180px] truncate text-sm text-muted-foreground" title={b.reason}>
										{b.reason}
									</TableCell>
									<TableCell><BlockStatusBadge status={b.status} /></TableCell>
									<TableCell className="text-right">
										{b.status === "Active" ? (
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleRelease(b)}
												data-testid={`release-block-${b.name}`}
											>
												Release
											</Button>
										) : null}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Create inventory block</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-3 py-2">
						<Picker
							label="Block type"
							value={form.block_type}
							onChange={(v) => setForm({ ...form, block_type: v as BlockType })}
							options={BLOCK_TYPES.map((t) => ({ value: t, label: t }))}
						/>
						<Picker
							label="Scope"
							value={form.scope}
							onChange={(v) => setForm({ ...form, scope: v as BlockScope, room: "", room_type: "" })}
							options={BLOCK_SCOPES.map((s) => ({ value: s, label: s }))}
						/>
						{form.scope === "Room" ? (
							<Picker
								label="Room"
								value={form.room}
								onChange={(v) => setForm({ ...form, room: v })}
								options={rooms.map((r) => ({ value: r.name, label: r.room_number }))}
							/>
						) : (
							<Picker
								label="Room type"
								value={form.room_type}
								onChange={(v) => setForm({ ...form, room_type: v })}
								options={roomTypes.map((rt) => ({ value: rt.name, label: rt.room_type_name }))}
							/>
						)}
						<div className="grid grid-cols-2 gap-3">
							<Field label="Start date">
								<Input
									type="date"
									value={form.start_date}
									onChange={(e) => setForm({ ...form, start_date: e.target.value })}
								/>
							</Field>
							<Field label="End date">
								<Input
									type="date"
									value={form.end_date}
									onChange={(e) => setForm({ ...form, end_date: e.target.value })}
								/>
							</Field>
						</div>
						<Field label="Reason">
							<Input
								value={form.reason}
								onChange={(e) => setForm({ ...form, reason: e.target.value })}
								placeholder="AC repair, VIP arrival, …"
							/>
						</Field>
						<div className="flex items-center gap-2">
							<Switch
								id="hard-block"
								checked={form.is_hard_block}
								onCheckedChange={(v) => setForm({ ...form, is_hard_block: v })}
							/>
							<Label htmlFor="hard-block" className="text-sm">Hard block (prevents allocation)</Label>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">Cancel</Button>
						</DialogClose>
						<Button
							onClick={handleCreate}
							disabled={
								saving ||
								!form.start_date ||
								!form.end_date ||
								!form.reason ||
								(form.scope === "Room" && !form.room) ||
								(form.scope === "Room Type" && !form.room_type)
							}
							data-testid="confirm-create-block"
						>
							{saving ? <Loader2 className="size-4 animate-spin" /> : null}
							Create block
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// ---------- Property Settings tab ----------

function PropertySettingsTab({ resortProperty }: { resortProperty: string }) {
	const [settings, setSettings] = useState<PropertySettings | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState({
		allow_dirty_allocation_default: 0,
		room_identifier_uniqueness: "Property" as RoomIdentifierUniqueness,
		hard_block_overlap_policy: "Strict" as HardBlockOverlapPolicy,
		default_room_naming_series: "",
	});

	useEffect(() => {
		setLoading(true);
		getPropertySettings(resortProperty)
			.then((s) => {
				setSettings(s);
				setForm({
					allow_dirty_allocation_default: s.allow_dirty_allocation_default,
					room_identifier_uniqueness: s.room_identifier_uniqueness,
					hard_block_overlap_policy: s.hard_block_overlap_policy,
					default_room_naming_series: s.default_room_naming_series ?? "",
				});
			})
			.catch((err) => reportError(err, "Could not load property settings"))
			.finally(() => setLoading(false));
	}, [resortProperty]);

	async function save() {
		setSaving(true);
		try {
			const updated = await updatePropertySettings(resortProperty, {
				...form,
				allow_dirty_allocation_default: form.allow_dirty_allocation_default,
			});
			setSettings(updated);
			toast.success("Settings saved");
		} catch (error) {
			reportError(error, "Could not save settings");
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading settings…
			</div>
		);
	}

	if (!settings) return null;

	return (
		<Card className="max-w-lg">
			<CardContent className="flex flex-col gap-4 py-6">
				<h3 className="text-sm font-semibold">Property Settings</h3>

				<div className="flex items-center gap-3">
					<Switch
						id="dirty-alloc"
						checked={form.allow_dirty_allocation_default === 1}
						onCheckedChange={(v) => setForm({ ...form, allow_dirty_allocation_default: v ? 1 : 0 })}
					/>
					<Label htmlFor="dirty-alloc" className="text-sm">
						Allow dirty room allocation by default
					</Label>
				</div>

				<Picker
					label="Room number uniqueness scope"
					value={form.room_identifier_uniqueness}
					onChange={(v) => setForm({ ...form, room_identifier_uniqueness: v as RoomIdentifierUniqueness })}
					options={[
						{ value: "Property", label: "Property-wide (unique across all buildings)" },
						{ value: "Building", label: "Building-scoped (same number allowed in different buildings)" },
					]}
				/>

				<Picker
					label="Hard block overlap policy"
					value={form.hard_block_overlap_policy}
					onChange={(v) => setForm({ ...form, hard_block_overlap_policy: v as HardBlockOverlapPolicy })}
					options={[
						{ value: "Strict", label: "Strict (no overlaps allowed)" },
						{ value: "Allow Same Source", label: "Allow same source (same document may overlap)" },
						{ value: "Manual Approval", label: "Manual approval required" },
					]}
				/>

				<Field label="Default room naming series">
					<Input
						value={form.default_room_naming_series}
						onChange={(e) => setForm({ ...form, default_room_naming_series: e.target.value })}
						placeholder="e.g. ROOM-.###"
					/>
				</Field>

				<Button onClick={save} disabled={saving} className="self-start" data-testid="save-settings">
					{saving ? <Loader2 className="size-4 animate-spin" /> : null}
					Save settings
				</Button>
			</CardContent>
		</Card>
	);
}

// ---------- Locations tab ----------

const LOCATION_TYPES: ServiceLocationType[] = [
	"Restaurant", "Bar", "Cafe", "Room Service", "Spa", "Gym", "Pool", "Retail", "Activity", "Other",
];

function LocationsTab({
	resortProperty,
	buildings,
	floors,
}: {
	resortProperty: string;
	buildings: { name: string; building_name: string }[];
	floors: { name: string; building: string; floor_label: string }[];
}) {
	const [locations, setLocations] = useState<ServiceLocation[]>([]);
	const [loading, setLoading] = useState(true);
	const [includeInactive, setIncludeInactive] = useState(false);
	const [editingLocation, setEditingLocation] = useState<ServiceLocation | null>(null);
	const [createOpen, setCreateOpen] = useState(false);

	const emptyForm = {
		location_name: "",
		location_code: "",
		location_type: "Restaurant" as ServiceLocationType,
		building: "",
		floor: "",
	};
	const [form, setForm] = useState(emptyForm);
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const result = await listServiceLocations(resortProperty, includeInactive);
			setLocations(result.locations);
		} catch (error) {
			reportError(error, "Could not load service locations");
		} finally {
			setLoading(false);
		}
	}, [resortProperty, includeInactive]);

	useEffect(() => { load(); }, [load]);

	async function handleCreate() {
		setSaving(true);
		try {
			await createServiceLocation({
				resort_property: resortProperty,
				location_name: form.location_name,
				location_code: form.location_code,
				location_type: form.location_type,
				building: form.building || undefined,
				floor: form.floor || undefined,
			});
			toast.success("Location created");
			setCreateOpen(false);
			setForm(emptyForm);
			await load();
		} catch (error) {
			reportError(error, "Could not create location");
		} finally {
			setSaving(false);
		}
	}

	async function handleUpdate() {
		if (!editingLocation) return;
		setSaving(true);
		try {
			await updateServiceLocation(editingLocation.name, {
				location_name: form.location_name,
				location_type: form.location_type,
				building: form.building || null,
				floor: form.floor || null,
			});
			toast.success("Location updated");
			setEditingLocation(null);
			await load();
		} catch (error) {
			reportError(error, "Could not update location");
		} finally {
			setSaving(false);
		}
	}

	async function handleToggleActive(loc: ServiceLocation) {
		try {
			await setServiceLocationActive(loc.name, !loc.is_active);
			toast.success(loc.is_active ? "Location deactivated" : "Location activated");
			await load();
		} catch (error) {
			reportError(error, "Could not update location");
		}
	}

	async function handleDelete(loc: ServiceLocation) {
		try {
			await deleteServiceLocation(loc.name);
			toast.success("Location deleted");
			await load();
		} catch (error) {
			reportError(error, "Could not delete location");
		}
	}

	function openEdit(loc: ServiceLocation) {
		setEditingLocation(loc);
		setForm({
			location_name: loc.location_name,
			location_code: loc.location_code,
			location_type: loc.location_type,
			building: loc.building ?? "",
			floor: loc.floor ?? "",
		});
	}

	const floorsForBuilding = floors.filter((f) => f.building === form.building);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					{loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
						<span className="text-sm text-muted-foreground">{locations.length} location(s)</span>
					)}
					<div className="flex items-center gap-2">
						<Switch
							id="show-inactive"
							checked={includeInactive}
							onCheckedChange={setIncludeInactive}
						/>
						<Label htmlFor="show-inactive" className="text-sm text-muted-foreground">Show inactive</Label>
					</div>
				</div>
				<Button size="sm" onClick={() => { setForm(emptyForm); setCreateOpen(true); }} data-testid="create-location">
					<Plus className="size-4" /> Add location
				</Button>
			</div>

			{!loading && locations.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						No service locations yet. Add a restaurant, spa, bar, or any outlet.
					</CardContent>
				</Card>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Code</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Building</TableHead>
								<TableHead>State</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{locations.map((loc) => (
								<TableRow key={loc.name} className={loc.is_active ? "" : "opacity-50"}>
									<TableCell className="font-medium">{loc.location_name}</TableCell>
									<TableCell className="font-mono text-xs">{loc.location_code}</TableCell>
									<TableCell><Badge variant="outline">{loc.location_type}</Badge></TableCell>
									<TableCell className="text-sm text-muted-foreground">{loc.building ?? "—"}</TableCell>
									<TableCell>
										{loc.is_active
											? <Badge variant="secondary">Active</Badge>
											: <Badge variant="outline">Inactive</Badge>
										}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button variant="ghost" size="icon" aria-label="Edit" onClick={() => openEdit(loc)}>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label="Toggle active"
												onClick={() => handleToggleActive(loc)}
											>
												<Power className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label="Delete"
												onClick={() => handleDelete(loc)}
											>
												<Trash2 className="size-4 text-destructive" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{/* Create dialog */}
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Add service location</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-3 py-2">
						<Field label="Name">
							<Input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} placeholder="Main Restaurant" />
						</Field>
						<Field label="Code">
							<Input value={form.location_code} onChange={(e) => setForm({ ...form, location_code: e.target.value })} placeholder="REST-MAIN" />
						</Field>
						<Picker
							label="Type"
							value={form.location_type}
							onChange={(v) => setForm({ ...form, location_type: v as ServiceLocationType })}
							options={LOCATION_TYPES.map((t) => ({ value: t, label: t }))}
						/>
						<Picker
							label="Building (optional)"
							value={form.building}
							onChange={(v) => setForm({ ...form, building: v, floor: "" })}
							options={[{ value: "", label: "None" }, ...buildings.map((b) => ({ value: b.name, label: b.building_name }))]}
						/>
						{form.building ? (
							<Picker
								label="Floor (optional)"
								value={form.floor}
								onChange={(v) => setForm({ ...form, floor: v })}
								options={[{ value: "", label: "None" }, ...floorsForBuilding.map((f) => ({ value: f.name, label: f.floor_label }))]}
							/>
						) : null}
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">Cancel</Button>
						</DialogClose>
						<Button
							onClick={handleCreate}
							disabled={saving || !form.location_name || !form.location_code}
							data-testid="confirm-create-location"
						>
							{saving ? <Loader2 className="size-4 animate-spin" /> : null}
							Add location
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Edit dialog */}
			<Dialog open={!!editingLocation} onOpenChange={(open) => { if (!open) setEditingLocation(null); }}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Edit {editingLocation?.location_name}</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-3 py-2">
						<Field label="Name">
							<Input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} />
						</Field>
						<Picker
							label="Type"
							value={form.location_type}
							onChange={(v) => setForm({ ...form, location_type: v as ServiceLocationType })}
							options={LOCATION_TYPES.map((t) => ({ value: t, label: t }))}
						/>
						<Picker
							label="Building (optional)"
							value={form.building}
							onChange={(v) => setForm({ ...form, building: v, floor: "" })}
							options={[{ value: "", label: "None" }, ...buildings.map((b) => ({ value: b.name, label: b.building_name }))]}
						/>
						{form.building ? (
							<Picker
								label="Floor (optional)"
								value={form.floor}
								onChange={(v) => setForm({ ...form, floor: v })}
								options={[{ value: "", label: "None" }, ...floorsForBuilding.map((f) => ({ value: f.name, label: f.floor_label }))]}
							/>
						) : null}
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setEditingLocation(null)}>Cancel</Button>
						<Button onClick={handleUpdate} disabled={saving || !form.location_name} data-testid="confirm-edit-location">
							{saving ? <Loader2 className="size-4 animate-spin" /> : null}
							Save changes
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// ---------- Inventory tab (room-type availability breakdown) ----------

function InventoryTab({ resortProperty }: { resortProperty: string }) {
	const [rows, setRows] = useState<RoomTypeInventoryRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const result = await getRoomTypeInventoryView(
				resortProperty,
				startDate || undefined,
				endDate || undefined,
			);
			setRows(result.inventory);
		} catch (error) {
			reportError(error, "Could not load inventory view");
		} finally {
			setLoading(false);
		}
	}, [resortProperty, startDate, endDate]);

	useEffect(() => { load(); }, [load]);

	const showRange = Boolean(startDate && endDate);

	return (
		<Card>
			<CardContent className="flex flex-col gap-4 py-4" data-testid="inventory-tab">
				<div className="flex flex-wrap items-end gap-3">
					<div className="flex flex-col gap-1">
						<Label className="text-xs text-muted-foreground">From</Label>
						<Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" data-testid="inventory-from" />
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-xs text-muted-foreground">To</Label>
						<Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" data-testid="inventory-to" />
					</div>
					{showRange ? (
						<Button variant="ghost" size="sm" onClick={() => { setStartDate(""); setEndDate(""); }}>
							Clear range
						</Button>
					) : null}
				</div>

				{loading ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" /> Loading…
					</div>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Room type</TableHead>
									<TableHead className="text-right">Total</TableHead>
									<TableHead className="text-right">Active</TableHead>
									<TableHead className="text-right">Sellable</TableHead>
									<TableHead className="text-right">Out of order</TableHead>
									<TableHead className="text-right">Out of service</TableHead>
									<TableHead className="text-right">Dirty</TableHead>
									{showRange ? <TableHead className="text-right">Available (range)</TableHead> : null}
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.length === 0 ? (
									<TableRow>
										<TableCell colSpan={showRange ? 8 : 7} className="text-sm text-muted-foreground">No room types.</TableCell>
									</TableRow>
								) : (
									rows.map((r) => (
										<TableRow key={r.room_type}>
											<TableCell className="font-medium">{r.room_type_name}</TableCell>
											<TableCell className="text-right">{r.total_rooms}</TableCell>
											<TableCell className="text-right">{r.active_rooms}</TableCell>
											<TableCell className="text-right">{r.sellable_rooms}</TableCell>
											<TableCell className="text-right">{r.out_of_order}</TableCell>
											<TableCell className="text-right">{r.out_of_service}</TableCell>
											<TableCell className="text-right">{r.dirty}</TableCell>
											{showRange ? <TableCell className="text-right font-medium">{r.available_for_range ?? "—"}</TableCell> : null}
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// ---------- Spaces tab (Event Space / Activity Area / Spa Room) ----------

const AREA_TYPES: ActivityAreaType[] = ["Spa Room", "Wellness", "Activity", "Pool", "Cabana", "Facility", "Other"];

function SpacesTab({
	resortProperty,
	buildings,
	floors,
}: {
	resortProperty: string;
	buildings: { name: string; building_name: string }[];
	floors: { name: string; floor_label: string; building: string }[];
}) {
	const [eventSpaces, setEventSpaces] = useState<EventSpace[]>([]);
	const [areas, setAreas] = useState<ActivityArea[]>([]);
	const [spaRooms, setSpaRooms] = useState<SpaRoom[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialog, setDialog] = useState<null | "event" | "area" | "spa">(null);
	const [saving, setSaving] = useState(false);
	const [ev, setEv] = useState({ space_name: "", space_code: "", building: "", floor: "", capacity: "" });
	const [ar, setAr] = useState({ area_name: "", area_code: "", area_type: "Spa Room" as ActivityAreaType, capacity: "" });
	const [sp, setSp] = useState({ spa_room_name: "", spa_room_code: "", capacity: "", default_duration_buffer: "" });

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [e, a, s] = await Promise.all([
				listEventSpaces(resortProperty),
				listActivityAreas(resortProperty),
				listSpaRooms(resortProperty),
			]);
			setEventSpaces(e.event_spaces);
			setAreas(a.activity_areas);
			setSpaRooms(s.spa_rooms);
		} catch (error) {
			reportError(error, "Could not load spaces");
		} finally {
			setLoading(false);
		}
	}, [resortProperty]);

	useEffect(() => { load(); }, [load]);

	const propertyFloors = useMemo(
		() => (ev.building ? floors.filter((f) => f.building === ev.building) : floors),
		[floors, ev.building],
	);

	async function saveEvent() {
		setSaving(true);
		try {
			await createEventSpace({
				resort_property: resortProperty,
				space_name: ev.space_name,
				space_code: ev.space_code,
				building: ev.building || undefined,
				floor: ev.floor || undefined,
				capacity: ev.capacity ? Number(ev.capacity) : undefined,
			});
			toast.success("Event space created");
			setDialog(null);
			setEv({ space_name: "", space_code: "", building: "", floor: "", capacity: "" });
			await load();
		} catch (error) {
			reportError(error, "Could not create event space");
		} finally {
			setSaving(false);
		}
	}

	async function saveArea() {
		setSaving(true);
		try {
			await createActivityArea({
				resort_property: resortProperty,
				area_name: ar.area_name,
				area_code: ar.area_code,
				area_type: ar.area_type,
				capacity: ar.capacity ? Number(ar.capacity) : undefined,
			});
			toast.success("Activity area created");
			setDialog(null);
			setAr({ area_name: "", area_code: "", area_type: "Spa Room", capacity: "" });
			await load();
		} catch (error) {
			reportError(error, "Could not create activity area");
		} finally {
			setSaving(false);
		}
	}

	async function saveSpa() {
		setSaving(true);
		try {
			await createSpaRoom({
				resort_property: resortProperty,
				spa_room_name: sp.spa_room_name,
				spa_room_code: sp.spa_room_code,
				capacity: sp.capacity ? Number(sp.capacity) : undefined,
				default_duration_buffer: sp.default_duration_buffer ? Number(sp.default_duration_buffer) : undefined,
			});
			toast.success("Spa room created");
			setDialog(null);
			setSp({ spa_room_name: "", spa_room_code: "", capacity: "", default_duration_buffer: "" });
			await load();
		} catch (error) {
			reportError(error, "Could not create spa room");
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>;
	}

	return (
		<div className="flex flex-col gap-6" data-testid="spaces-tab">
			<SpaceSection
				title="Event spaces"
				addLabel="Add event space"
				onAdd={() => setDialog("event")}
				rows={eventSpaces.map((s) => ({ name: s.name, label: s.space_name, meta: s.space_code, status: s.operating_status, active: s.is_active }))}
				onToggle={(name, active) => setEventSpaceActive(name, active).then(load).catch((e) => reportError(e, "Could not update"))}
			/>
			<SpaceSection
				title="Activity areas"
				addLabel="Add activity area"
				onAdd={() => setDialog("area")}
				rows={areas.map((a) => ({ name: a.name, label: a.area_name, meta: `${a.area_type} · ${a.area_code}`, status: a.operating_status, active: a.is_active }))}
				onToggle={(name, active) => setActivityAreaActive(name, active).then(load).catch((e) => reportError(e, "Could not update"))}
			/>
			<SpaceSection
				title="Spa rooms"
				addLabel="Add spa room"
				onAdd={() => setDialog("spa")}
				rows={spaRooms.map((s) => ({ name: s.name, label: s.spa_room_name, meta: s.spa_room_code, status: s.operating_status, active: s.is_active }))}
				onToggle={(name, active) => setSpaRoomActive(name, active).then(load).catch((e) => reportError(e, "Could not update"))}
			/>

			<Dialog open={dialog === "event"} onOpenChange={(o) => { if (!o) setDialog(null); }}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader><DialogTitle>Add event space</DialogTitle></DialogHeader>
					<div className="grid gap-3">
						<Field label="Name"><Input value={ev.space_name} onChange={(e) => setEv({ ...ev, space_name: e.target.value })} /></Field>
						<Field label="Code"><Input value={ev.space_code} onChange={(e) => setEv({ ...ev, space_code: e.target.value })} /></Field>
						<Field label="Building">
							<Select value={ev.building} onValueChange={(v) => setEv({ ...ev, building: v, floor: "" })}>
								<SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
								<SelectContent>{buildings.map((b) => <SelectItem key={b.name} value={b.name}>{b.building_name}</SelectItem>)}</SelectContent>
							</Select>
						</Field>
						<Field label="Floor">
							<Select value={ev.floor} onValueChange={(v) => setEv({ ...ev, floor: v })}>
								<SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
								<SelectContent>{propertyFloors.map((f) => <SelectItem key={f.name} value={f.name}>{f.floor_label}</SelectItem>)}</SelectContent>
							</Select>
						</Field>
						<Field label="Capacity"><Input type="number" value={ev.capacity} onChange={(e) => setEv({ ...ev, capacity: e.target.value })} /></Field>
					</div>
					<DialogFooter>
						<DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
						<Button onClick={saveEvent} disabled={saving || !ev.space_name || !ev.space_code}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} Create</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={dialog === "area"} onOpenChange={(o) => { if (!o) setDialog(null); }}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader><DialogTitle>Add activity area</DialogTitle></DialogHeader>
					<div className="grid gap-3">
						<Field label="Name"><Input value={ar.area_name} onChange={(e) => setAr({ ...ar, area_name: e.target.value })} /></Field>
						<Field label="Code"><Input value={ar.area_code} onChange={(e) => setAr({ ...ar, area_code: e.target.value })} /></Field>
						<Field label="Type">
							<Select value={ar.area_type} onValueChange={(v) => setAr({ ...ar, area_type: v as ActivityAreaType })}>
								<SelectTrigger><SelectValue /></SelectTrigger>
								<SelectContent>{AREA_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
							</Select>
						</Field>
						<Field label="Capacity"><Input type="number" value={ar.capacity} onChange={(e) => setAr({ ...ar, capacity: e.target.value })} /></Field>
					</div>
					<DialogFooter>
						<DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
						<Button onClick={saveArea} disabled={saving || !ar.area_name || !ar.area_code}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} Create</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={dialog === "spa"} onOpenChange={(o) => { if (!o) setDialog(null); }}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader><DialogTitle>Add spa room</DialogTitle></DialogHeader>
					<div className="grid gap-3">
						<Field label="Name"><Input value={sp.spa_room_name} onChange={(e) => setSp({ ...sp, spa_room_name: e.target.value })} /></Field>
						<Field label="Code"><Input value={sp.spa_room_code} onChange={(e) => setSp({ ...sp, spa_room_code: e.target.value })} /></Field>
						<Field label="Capacity"><Input type="number" value={sp.capacity} onChange={(e) => setSp({ ...sp, capacity: e.target.value })} /></Field>
						<Field label="Turnover buffer (min)"><Input type="number" value={sp.default_duration_buffer} onChange={(e) => setSp({ ...sp, default_duration_buffer: e.target.value })} /></Field>
					</div>
					<DialogFooter>
						<DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
						<Button onClick={saveSpa} disabled={saving || !sp.spa_room_name || !sp.spa_room_code}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} Create</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function SpaceSection({
	title,
	addLabel,
	onAdd,
	rows,
	onToggle,
}: {
	title: string;
	addLabel: string;
	onAdd: () => void;
	rows: { name: string; label: string; meta: string; status: string; active: number }[];
	onToggle: (name: string, active: boolean) => void;
}) {
	return (
		<Card>
			<CardContent className="flex flex-col gap-3 py-4">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-semibold">{title}</h3>
					<Button variant="outline" size="sm" onClick={onAdd}><Plus className="size-4" /> {addLabel}</Button>
				</div>
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">None yet.</p>
				) : (
					<div className="flex flex-col divide-y">
						{rows.map((r) => (
							<div key={r.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
								<div className="flex flex-col">
									<span className="text-sm font-medium">{r.label}{r.active ? "" : " (inactive)"}</span>
									<span className="text-xs text-muted-foreground">{r.meta} · {r.status}</span>
								</div>
								<div className="flex items-center gap-2">
									<span className="text-xs text-muted-foreground">Active</span>
									<Switch checked={Boolean(r.active)} onCheckedChange={(v) => onToggle(r.name, v)} aria-label={`Toggle ${r.label}`} />
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
