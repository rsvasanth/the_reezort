/**
 * Room editor drawer — edit room details + statuses and manage its equipment
 * (WiFi / TV / AC … each with a condition). Saving persists both in one go.
 */

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	EQUIPMENT_CONDITIONS,
	FolioApiError,
	getRoomEquipment,
	setRoomEquipment,
	updateRecord,
	type Amenity,
	type EquipmentCondition,
	type RoomEquipmentItem,
	type TreeRoom,
	type TreeRoomType,
} from "@/lib/setup-api";

// Mirror the Room doctype Select options exactly.
const OCCUPANCY = ["Vacant", "Reserved", "Occupied", "Due In", "Due Out", "Checked Out", "Hold"];
const HOUSEKEEPING = ["Clean", "Dirty", "In Progress", "Inspected", "Pickup", "Turndown Required", "Out of Service Cleaning"];
const MAINTENANCE = ["Available", "Maintenance Requested", "Under Maintenance", "Out of Order", "Out of Service", "Preventive Maintenance"];
const SELLABLE = ["Sellable", "Not Sellable", "Restricted", "Temporarily Blocked"];
const SMOKING = ["Non-Smoking", "Smoking", "Flexible"];

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

export function RoomSheet({
	room,
	roomTypes,
	amenities,
	onClose,
	onSaved,
}: {
	room: TreeRoom;
	roomTypes: TreeRoomType[];
	amenities: Amenity[];
	onClose: () => void;
	onSaved: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [loadingEquip, setLoadingEquip] = useState(true);
	const [form, setForm] = useState({
		room_name: room.room_name ?? "",
		room_type: room.room_type,
		smoking_policy: room.smoking_policy,
		occupancy_status: room.occupancy_status,
		housekeeping_status: room.housekeeping_status,
		maintenance_status: room.maintenance_status,
		sellable_status: room.sellable_status,
	});
	const [equipment, setEquipment] = useState<RoomEquipmentItem[]>([]);

	useEffect(() => {
		getRoomEquipment(room.name)
			.then((res) => setEquipment(res.items))
			.catch(() => setEquipment([]))
			.finally(() => setLoadingEquip(false));
	}, [room.name]);

	function addRow() {
		const first = amenities[0];
		if (!first) {
			toast.error("No equipment types yet", { description: "Add some in the Equipment catalog tab first." });
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

	async function save() {
		setBusy(true);
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
			onSaved();
			onClose();
		} catch (error) {
			reportError(error, "Could not save the room");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl" data-testid="room-sheet">
				<SheetHeader>
					<SheetTitle>Room {room.room_number}</SheetTitle>
					<SheetDescription>{room.name}</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-5 px-4 py-4">
					{/* Details */}
					<section className="grid gap-4 sm:grid-cols-2">
						<LabeledInput label="Room name">
							<Input
								value={form.room_name}
								onChange={(e) => setForm({ ...form, room_name: e.target.value })}
								placeholder="e.g. Sea View Deluxe"
								data-testid="room-name"
							/>
						</LabeledInput>
						<LabeledSelect label="Room type" value={form.room_type} onChange={(v) => setForm({ ...form, room_type: v })}>
							{roomTypes.map((rt) => (
								<SelectItem key={rt.name} value={rt.name}>
									{rt.room_type_name}
								</SelectItem>
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
					</section>

					<Separator />

					{/* Equipment */}
					<section className="flex flex-col gap-3" data-testid="room-equipment">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold">Equipment &amp; condition</h3>
							<Button variant="outline" size="sm" onClick={addRow} data-testid="add-equipment">
								<Plus className="size-4" /> Add
							</Button>
						</div>

						{loadingEquip ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" /> Loading equipment…
							</div>
						) : equipment.length === 0 ? (
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
											<SelectItem key={a.name} value={a.name}>
												{a.amenity_name}
											</SelectItem>
										))}
									</LabeledSelect>
									<LabeledSelect
										label="Condition"
										value={row.condition}
										onChange={(v) => updateRow(index, { condition: v as EquipmentCondition })}
									>
										{EQUIPMENT_CONDITIONS.map((c) => (
											<SelectItem key={c} value={c}>
												{c}
											</SelectItem>
										))}
									</LabeledSelect>
									<LabeledInput label="Label">
										<Input
											value={row.label ?? ""}
											onChange={(e) => updateRow(index, { label: e.target.value })}
											placeholder="model / tag"
										/>
									</LabeledInput>
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
					</section>
				</div>

				<SheetFooter>
					<Button onClick={save} disabled={busy} data-testid="room-save">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null}
						Save room
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
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
	onChange: (v: string) => void;
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
