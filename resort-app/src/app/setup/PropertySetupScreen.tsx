/**
 * Property Setup — guided onboarding wizard.
 *
 * Walks the master-data chain in order, one record per step, each saved via the
 * idempotent the_reezort.setup.api.* endpoints:
 *
 *   Property → Building → Floor → Room Type → Rooms (bulk) → Review
 *
 * Does NOT render its own shell — mount inside <AppShell> so the sidebar stays.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Check, Building2, Layers, BedDouble, DoorOpen, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	FolioApiError,
	createBuilding,
	createFloor,
	createProperty,
	createRoomType,
	createRoomsBulk,
	getPropertyTree,
	listSetupOptions,
	type BuildingRecord,
	type FloorRecord,
	type PropertyRecord,
	type PropertyTree,
	type RoomTypeRecord,
	type SetupOptions,
	type SmokingPolicy,
} from "@/lib/setup-api";

const STEPS = [
	{ key: "property", label: "Property", icon: Building2 },
	{ key: "building", label: "Building", icon: Layers },
	{ key: "floor", label: "Floor", icon: Layers },
	{ key: "roomType", label: "Room Type", icon: BedDouble },
	{ key: "rooms", label: "Rooms", icon: DoorOpen },
	{ key: "review", label: "Review", icon: ClipboardCheck },
] as const;

const SMOKING_POLICIES: SmokingPolicy[] = ["Non-Smoking", "Smoking", "Flexible"];

function reportError(error: unknown, fallback: string) {
	if (error instanceof FolioApiError) {
		const detail = error.blockers[0]?.message ?? error.message;
		toast.error(fallback, { description: detail });
	} else {
		toast.error(fallback, { description: String(error) });
	}
}

function generateRoomNumbers(start: string, count: number): string[] {
	const trimmed = start.trim();
	const match = trimmed.match(/^(\D*)(\d+)$/);
	if (!match) {
		// Non-numeric — just repeat with -N suffix.
		return Array.from({ length: count }, (_, i) => (i === 0 ? trimmed : `${trimmed}-${i + 1}`));
	}
	const [, prefix, digits] = match;
	const base = parseInt(digits, 10);
	const pad = digits.length;
	return Array.from({ length: count }, (_, i) =>
		`${prefix}${String(base + i).padStart(pad, "0")}`
	);
}

export default function PropertySetupScreen() {
	const [step, setStep] = useState(0);
	const [busy, setBusy] = useState(false);
	const [options, setOptions] = useState<SetupOptions | null>(null);
	const [optionsError, setOptionsError] = useState(false);

	const [property, setProperty] = useState<PropertyRecord | null>(null);
	const [building, setBuilding] = useState<BuildingRecord | null>(null);
	const [floor, setFloor] = useState<FloorRecord | null>(null);
	const [roomType, setRoomType] = useState<RoomTypeRecord | null>(null);
	const [tree, setTree] = useState<PropertyTree | null>(null);

	const [pForm, setPForm] = useState({
		property_name: "",
		property_code: "",
		company: "",
		timezone: "Asia/Kolkata",
		default_currency: "",
	});
	const [bForm, setBForm] = useState({ building_name: "", building_code: "" });
	const [fForm, setFForm] = useState({ floor_label: "", floor_code: "" });
	const [rtForm, setRtForm] = useState({
		room_type_name: "",
		room_type_code: "",
		standard_adults: "2",
		max_occupancy: "2",
	});
	const [roomForm, setRoomForm] = useState({
		start: "101",
		count: "10",
		smoking_policy: "Non-Smoking" as SmokingPolicy,
	});

	useEffect(() => {
		listSetupOptions()
			.then((opts) => {
				setOptions(opts);
				const firstCompany = opts.companies[0];
				if (firstCompany) {
					setPForm((prev) => ({
						...prev,
						company: prev.company || firstCompany.name,
						default_currency: prev.default_currency || firstCompany.default_currency || "INR",
					}));
				}
			})
			.catch(() => setOptionsError(true));
	}, []);

	const roomPreview = useMemo(() => {
		const count = Math.max(0, Math.min(200, parseInt(roomForm.count, 10) || 0));
		return generateRoomNumbers(roomForm.start, count);
	}, [roomForm.start, roomForm.count]);

	async function run<T>(fn: () => Promise<T>, fallback: string): Promise<T | undefined> {
		setBusy(true);
		try {
			return await fn();
		} catch (error) {
			reportError(error, fallback);
			return undefined;
		} finally {
			setBusy(false);
		}
	}

	async function submitProperty() {
		const result = await run(
			() =>
				createProperty({
					property_name: pForm.property_name,
					property_code: pForm.property_code,
					company: pForm.company,
					timezone: pForm.timezone,
					default_currency: pForm.default_currency || null,
				}),
			"Could not save the property"
		);
		if (!result) return;
		setProperty(result.property);
		toast.success(result.reused ? "Using existing property" : "Property saved", {
			description: result.property.name,
		});
		setStep(1);
	}

	async function submitBuilding() {
		if (!property) return;
		const result = await run(
			() =>
				createBuilding({
					resort_property: property.name,
					building_name: bForm.building_name,
					building_code: bForm.building_code,
				}),
			"Could not save the building"
		);
		if (!result) return;
		setBuilding(result.building);
		toast.success(result.reused ? "Using existing building" : "Building saved", {
			description: result.building.name,
		});
		setStep(2);
	}

	async function submitFloor() {
		if (!property || !building) return;
		const result = await run(
			() =>
				createFloor({
					resort_property: property.name,
					building: building.name,
					floor_label: fForm.floor_label,
					floor_code: fForm.floor_code,
				}),
			"Could not save the floor"
		);
		if (!result) return;
		setFloor(result.floor);
		toast.success(result.reused ? "Using existing floor" : "Floor saved", {
			description: result.floor.name,
		});
		setStep(3);
	}

	async function submitRoomType() {
		if (!property) return;
		const result = await run(
			() =>
				createRoomType({
					resort_property: property.name,
					room_type_name: rtForm.room_type_name,
					room_type_code: rtForm.room_type_code,
					standard_adults: parseInt(rtForm.standard_adults, 10) || 2,
					max_occupancy: parseInt(rtForm.max_occupancy, 10) || 2,
				}),
			"Could not save the room type"
		);
		if (!result) return;
		setRoomType(result.room_type);
		toast.success(result.reused ? "Using existing room type" : "Room type saved", {
			description: result.room_type.name,
		});
		setStep(4);
	}

	async function submitRooms() {
		if (!property || !building || !floor || !roomType) return;
		const result = await run(
			() =>
				createRoomsBulk({
					resort_property: property.name,
					building: building.name,
					floor: floor.name,
					room_type: roomType.name,
					room_numbers: roomPreview,
					smoking_policy: roomForm.smoking_policy,
				}),
			"Could not create rooms"
		);
		if (!result) return;
		toast.success(`Created ${result.created_count} room(s)`, {
			description: result.skipped_count
				? `${result.skipped_count} already existed and were skipped`
				: undefined,
		});
		const built = await run(() => getPropertyTree(property.name), "Could not load summary");
		if (built) setTree(built);
		setStep(5);
	}

	function resetWizard() {
		setProperty(null);
		setBuilding(null);
		setFloor(null);
		setRoomType(null);
		setTree(null);
		setStep(0);
		setBForm({ building_name: "", building_code: "" });
		setFForm({ floor_label: "", floor_code: "" });
		setRtForm({ room_type_name: "", room_type_code: "", standard_adults: "2", max_occupancy: "2" });
		setRoomForm({ start: "101", count: "10", smoking_policy: "Non-Smoking" });
	}

	const current = STEPS[step];

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6" data-testid="setup-screen">
			<header className="max-w-3xl">
				<div className="mb-3 flex flex-wrap gap-2">
					<Badge variant="outline">Property setup</Badge>
					{property ? <Badge variant="secondary">{property.name}</Badge> : null}
				</div>
				<h1 className="text-3xl font-light text-foreground md:text-4xl">Onboard a property</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					A guided flow — property, building, floor, room type, then rooms in bulk. No ERPNext
					screens. Each step saves immediately and can be safely re-run.
				</p>
			</header>

			{/* Stepper */}
			<ol className="flex flex-wrap items-center gap-2" data-testid="setup-stepper">
				{STEPS.map((s, i) => {
					const StepIcon = s.icon;
					const done = i < step;
					const active = i === step;
					return (
						<li key={s.key} className="flex items-center gap-2">
							<span
								className={[
									"flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
									active
										? "border-foreground bg-foreground text-background"
										: done
											? "border-emerald-600/40 bg-emerald-50 text-emerald-700"
											: "border-border text-muted-foreground",
								].join(" ")}
							>
								{done ? <Check className="size-3.5" /> : <StepIcon className="size-3.5" />}
								{s.label}
							</span>
							{i < STEPS.length - 1 ? <span className="text-muted-foreground">→</span> : null}
						</li>
					);
				})}
			</ol>

			<Card className="max-w-3xl">
				<CardHeader>
					<CardTitle data-testid="setup-step-title">Step {step + 1} · {current.label}</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-5">
					{optionsError ? (
						<p className="text-sm text-destructive">
							Could not load setup options. Check your permissions and refresh.
						</p>
					) : !options ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading options…
						</div>
					) : (
						<>
							{step === 0 && (
								<div className="grid gap-4 sm:grid-cols-2">
									<Field label="Property name" required>
										<Input
											value={pForm.property_name}
											onChange={(e) => setPForm({ ...pForm, property_name: e.target.value })}
											placeholder="The Reezort Goa"
											data-testid="f-property-name"
										/>
									</Field>
									<Field label="Property code" required hint="Short unique id, e.g. RZ-GOA">
										<Input
											value={pForm.property_code}
											onChange={(e) => setPForm({ ...pForm, property_code: e.target.value })}
											placeholder="RZ-GOA"
											data-testid="f-property-code"
										/>
									</Field>
									<Field label="Company" required>
										<Select
											value={pForm.company}
											onValueChange={(v) => setPForm({ ...pForm, company: v })}
										>
											<SelectTrigger data-testid="f-company">
												<SelectValue placeholder="Select company" />
											</SelectTrigger>
											<SelectContent>
												{options.companies.map((c) => (
													<SelectItem key={c.name} value={c.name}>
														{c.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</Field>
									<Field label="Timezone" required>
										<Input
											value={pForm.timezone}
											onChange={(e) => setPForm({ ...pForm, timezone: e.target.value })}
											placeholder="Asia/Kolkata"
											data-testid="f-timezone"
										/>
									</Field>
									<Field label="Default currency">
										<Select
											value={pForm.default_currency}
											onValueChange={(v) => setPForm({ ...pForm, default_currency: v })}
										>
											<SelectTrigger data-testid="f-currency">
												<SelectValue placeholder="Currency" />
											</SelectTrigger>
											<SelectContent>
												{options.currencies.map((c) => (
													<SelectItem key={c} value={c}>
														{c}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</Field>
								</div>
							)}

							{step === 1 && (
								<div className="grid gap-4 sm:grid-cols-2">
									<Field label="Building name" required>
										<Input
											value={bForm.building_name}
											onChange={(e) => setBForm({ ...bForm, building_name: e.target.value })}
											placeholder="Main Block"
											data-testid="f-building-name"
										/>
									</Field>
									<Field label="Building code" required hint="e.g. MAIN">
										<Input
											value={bForm.building_code}
											onChange={(e) => setBForm({ ...bForm, building_code: e.target.value })}
											placeholder="MAIN"
											data-testid="f-building-code"
										/>
									</Field>
								</div>
							)}

							{step === 2 && (
								<div className="grid gap-4 sm:grid-cols-2">
									<Field label="Floor label" required>
										<Input
											value={fForm.floor_label}
											onChange={(e) => setFForm({ ...fForm, floor_label: e.target.value })}
											placeholder="Floor 1"
											data-testid="f-floor-label"
										/>
									</Field>
									<Field label="Floor code" required hint="e.g. 1">
										<Input
											value={fForm.floor_code}
											onChange={(e) => setFForm({ ...fForm, floor_code: e.target.value })}
											placeholder="1"
											data-testid="f-floor-code"
										/>
									</Field>
								</div>
							)}

							{step === 3 && (
								<div className="grid gap-4 sm:grid-cols-2">
									<Field label="Room type name" required>
										<Input
											value={rtForm.room_type_name}
											onChange={(e) => setRtForm({ ...rtForm, room_type_name: e.target.value })}
											placeholder="Deluxe"
											data-testid="f-roomtype-name"
										/>
									</Field>
									<Field label="Room type code" required hint="e.g. DLX">
										<Input
											value={rtForm.room_type_code}
											onChange={(e) => setRtForm({ ...rtForm, room_type_code: e.target.value })}
											placeholder="DLX"
											data-testid="f-roomtype-code"
										/>
									</Field>
									<Field label="Standard adults" required>
										<Input
											type="number"
											min="1"
											value={rtForm.standard_adults}
											onChange={(e) => setRtForm({ ...rtForm, standard_adults: e.target.value })}
											data-testid="f-roomtype-adults"
										/>
									</Field>
									<Field label="Max occupancy" required>
										<Input
											type="number"
											min="1"
											value={rtForm.max_occupancy}
											onChange={(e) => setRtForm({ ...rtForm, max_occupancy: e.target.value })}
											data-testid="f-roomtype-max"
										/>
									</Field>
								</div>
							)}

							{step === 4 && (
								<div className="flex flex-col gap-4">
									<div className="grid gap-4 sm:grid-cols-3">
										<Field label="Start room number" required hint="e.g. 101">
											<Input
												value={roomForm.start}
												onChange={(e) => setRoomForm({ ...roomForm, start: e.target.value })}
												data-testid="f-room-start"
											/>
										</Field>
										<Field label="How many rooms" required>
											<Input
												type="number"
												min="1"
												max="200"
												value={roomForm.count}
												onChange={(e) => setRoomForm({ ...roomForm, count: e.target.value })}
												data-testid="f-room-count"
											/>
										</Field>
										<Field label="Smoking policy">
											<Select
												value={roomForm.smoking_policy}
												onValueChange={(v) =>
													setRoomForm({ ...roomForm, smoking_policy: v as SmokingPolicy })
												}
											>
												<SelectTrigger data-testid="f-room-smoking">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{SMOKING_POLICIES.map((p) => (
														<SelectItem key={p} value={p}>
															{p}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</Field>
									</div>
									<div>
										<Label className="text-xs text-muted-foreground">
											Will create {roomPreview.length} room(s)
										</Label>
										<div className="mt-2 flex flex-wrap gap-1.5" data-testid="room-preview">
											{roomPreview.slice(0, 40).map((n) => (
												<Badge key={n} variant="secondary" className="font-mono">
													{n}
												</Badge>
											))}
											{roomPreview.length > 40 ? (
												<Badge variant="outline">+{roomPreview.length - 40} more</Badge>
											) : null}
										</div>
									</div>
								</div>
							)}

							{step === 5 && (
								<div className="flex flex-col gap-4" data-testid="setup-summary">
									<div className="flex items-center gap-2 text-emerald-700">
										<Check className="size-5" />
										<span className="font-medium">Property is ready.</span>
									</div>
									<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
										<SummaryStat label="Buildings" value={tree?.counts.buildings ?? 0} />
										<SummaryStat label="Floors" value={tree?.counts.floors ?? 0} />
										<SummaryStat label="Room types" value={tree?.counts.room_types ?? 0} />
										<SummaryStat label="Rooms" value={tree?.counts.rooms ?? 0} />
									</div>
									<Separator />
									<p className="text-sm text-muted-foreground">
										These rooms now appear on the Housekeeping board and are available to
										reservations. You can add more buildings, floors, or room types by running the
										wizard again.
									</p>
								</div>
							)}

							<Separator />

							{/* Step actions */}
							<div className="flex items-center justify-between">
								<Button
									variant="ghost"
									disabled={busy || step === 0 || step === 5}
									onClick={() => setStep((s) => Math.max(0, s - 1))}
								>
									Back
								</Button>
								<div className="flex gap-2">
									{step === 0 && (
										<StepButton busy={busy} onClick={submitProperty}>
											Save &amp; continue
										</StepButton>
									)}
									{step === 1 && (
										<StepButton busy={busy} onClick={submitBuilding}>
											Save &amp; continue
										</StepButton>
									)}
									{step === 2 && (
										<StepButton busy={busy} onClick={submitFloor}>
											Save &amp; continue
										</StepButton>
									)}
									{step === 3 && (
										<StepButton busy={busy} onClick={submitRoomType}>
											Save &amp; continue
										</StepButton>
									)}
									{step === 4 && (
										<StepButton busy={busy} onClick={submitRooms}>
											Create {roomPreview.length} room(s)
										</StepButton>
									)}
									{step === 5 && (
										<Button onClick={resetWizard} data-testid="setup-restart">
											Onboard another
										</Button>
									)}
								</div>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</main>
	);
}

function Field({
	label,
	required,
	hint,
	children,
}: {
	label: string;
	required?: boolean;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-sm">
				{label}
				{required ? <span className="text-destructive"> *</span> : null}
			</Label>
			{children}
			{hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
		</div>
	);
}

function StepButton({
	busy,
	onClick,
	children,
}: {
	busy: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Button onClick={onClick} disabled={busy} data-testid="setup-next">
			{busy ? <Loader2 className="size-4 animate-spin" /> : null}
			{children}
		</Button>
	);
}

function SummaryStat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border bg-card p-3">
			<div className="text-2xl font-semibold">{value}</div>
			<div className="text-xs text-muted-foreground">{label}</div>
		</div>
	);
}
