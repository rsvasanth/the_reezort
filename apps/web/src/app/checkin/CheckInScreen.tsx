import { useCallback, useEffect, useRef, useState } from "react";
import {
	BadgeCheck,
	Check,
	CreditCard,
	DoorOpen,
	FileSignature,
	IdCard,
	Loader2,
	LogIn,
	Printer,
	ShieldAlert,
	ShieldCheck,
	Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { Field } from "@/components/workspace/field";
import { SignaturePad } from "@/components/workspace/signature-pad";
import { KpiStrip, RecordHeader, WorkspacePage } from "@/components/workspace/workspace";
import { RoomReadinessCard } from "@/components/housekeeping/room-readiness-card";
import ConditionCaptureScreen from "@/app/condition/ConditionCaptureScreen";

import { uploadConditionPhoto } from "@/lib/condition-api";
import { getOrCreateFolio, payDepositViaRazorpay, recordDeposit } from "@/lib/folio-api";
import {
	finalizeCheckIn,
	getCheckInContext,
	saveGuestKyc,
	saveRegistrationCard,
	type CheckInContext,
	type IdType,
	type NameMatchStatus,
	type PurposeOfVisit,
} from "@/lib/pms-api";

const ID_TYPES: IdType[] = ["Aadhaar", "Passport", "Driving License", "Voter ID", "PAN Card", "Other"];
const PURPOSES: PurposeOfVisit[] = ["Leisure", "Business", "Event", "Honeymoon", "Other"];
const PAYMENT_MODES = ["Razorpay (card / UPI)", "Cash", "Credit Card", "UPI", "Bank Draft"];

const STEPS = [
	{ key: "kyc", label: "Identity & KYC", icon: IdCard },
	{ key: "registration", label: "Registration", icon: FileSignature },
	{ key: "room", label: "Room", icon: DoorOpen },
	{ key: "deposit", label: "Deposit", icon: CreditCard },
	{ key: "finalize", label: "Finalize", icon: LogIn },
	{ key: "photos", label: "Condition photos", icon: ShieldCheck },
] as const;

function go(hash: string) {
	window.location.hash = hash;
}

function rupees(n?: number | null): string {
	return `₹${Number(n ?? 0).toLocaleString("en-IN")}`;
}

export default function CheckInScreen({ reservation }: { reservation: string }) {
	const [ctx, setCtx] = useState<CheckInContext | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [step, setStep] = useState(0);
	const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const next = await getCheckInContext(reservation);
			setCtx(next);
			setLoadError(null);
			return next;
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : "Could not load check-in");
			return null;
		}
	}, [reservation]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	if (loadError) {
		return (
			<WorkspacePage badge="Check-In" title="Check-in" onBack={() => go("#/frontdesk")}>
				<Card><CardContent className="py-8 text-sm text-destructive">{loadError}</CardContent></Card>
			</WorkspacePage>
		);
	}

	if (!ctx) {
		return (
			<WorkspacePage badge="Check-In" title="Check-in" onBack={() => go("#/frontdesk")}>
				<div className="flex flex-col gap-3">
					<Skeleton className="h-32 w-full" />
					<Skeleton className="h-64 w-full" />
				</div>
			</WorkspacePage>
		);
	}

	const guestName = ctx.guest?.guest_full_name ?? "Guest";
	const r = ctx.readiness;

	return (
		<WorkspacePage
			badge="Check-In"
			tag={ctx.room_type_name ?? undefined}
			title={guestName}
			subtitle={`Reservation ${ctx.reservation}`}
			onBack={() => go("#/frontdesk")}
			testId="checkin-screen"
		>
			<RecordHeader
				avatarName={guestName}
				avatarUrl={ctx.guest?.image}
				title={guestName}
				subtitle={ctx.room_type_name ?? "—"}
				idChip={ctx.reservation}
				statuses={[
					{ label: ctx.status },
					{ label: r.kyc ? "KYC verified" : "KYC pending", variant: r.kyc ? "default" : "secondary" },
					{ label: r.registration ? "Registered" : "Unregistered", variant: r.registration ? "default" : "secondary" },
				]}
				meta={[
					{ label: "Arrival", value: ctx.arrival_date ?? "—" },
					{ label: "Departure", value: ctx.departure_date ?? "—" },
					{ label: "Nights", value: ctx.nights ?? "—" },
				]}
			/>

			<KpiStrip
				items={[
					{ label: "Villas available", value: ctx.available_rooms.length, accent: ctx.available_rooms.length ? "good" : "danger" },
					{ label: "Deposit taken", value: rupees(ctx.deposit?.deposit_total), accent: r.deposit ? "good" : undefined },
					{ label: "Photos", value: ctx.condition_capture.count, accent: r.photos ? "good" : undefined },
					{ label: "Ready to finalize", value: r.can_finalize ? "Yes" : "No", accent: r.can_finalize ? "good" : "warn" },
				]}
			/>

			<Stepper step={step} setStep={setStep} ctx={ctx} />

			<div className="mt-4">
				{step === 0 && <KycStep ctx={ctx} reservation={reservation} refresh={refresh} onDone={() => setStep(1)} />}
				{step === 1 && <RegistrationStep ctx={ctx} reservation={reservation} refresh={refresh} onDone={() => setStep(2)} />}
				{step === 2 && <RoomStep ctx={ctx} selectedRoom={selectedRoom} setSelectedRoom={setSelectedRoom} onDone={() => setStep(3)} />}
				{step === 3 && <DepositStep ctx={ctx} reservation={reservation} refresh={refresh} onDone={() => setStep(4)} />}
				{step === 4 && <FinalizeStep ctx={ctx} reservation={reservation} room={selectedRoom} refresh={refresh} onDone={() => setStep(5)} />}
				{step === 5 && <PhotosStep ctx={ctx} />}
			</div>
		</WorkspacePage>
	);
}

// ---------- stepper rail ----------

function Stepper({ step, setStep, ctx }: { step: number; setStep: (n: number) => void; ctx: CheckInContext }) {
	const completed = [
		ctx.readiness.kyc,
		ctx.readiness.registration,
		Boolean(ctx.stay?.current_room) || ctx.available_rooms.length > 0,
		ctx.readiness.deposit,
		Boolean(ctx.stay),
		ctx.readiness.photos,
	];
	return (
		<ol className="mt-4 flex flex-wrap items-center gap-2 text-sm">
			{STEPS.map((s, i) => {
				const done = completed[i];
				const active = i === step;
				const Icon = s.icon;
				return (
					<li key={s.key} className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setStep(i)}
							className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors ${
								active
									? "border-foreground bg-foreground text-background"
									: done
										? "border-success/40 bg-success/10 text-success"
										: "border-border text-muted-foreground hover:text-foreground"
							}`}
							data-testid={`checkin-step-${s.key}`}
						>
							{done && !active ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
							{s.label}
						</button>
						{i < STEPS.length - 1 ? <span className="text-muted-foreground">→</span> : null}
					</li>
				);
			})}
		</ol>
	);
}

function StepCard({ children }: { children: React.ReactNode }) {
	return <Card><CardContent className="flex flex-col gap-4 py-5">{children}</CardContent></Card>;
}

// ---------- step 0: KYC ----------

function KycStep({
	ctx,
	reservation,
	refresh,
	onDone,
}: {
	ctx: CheckInContext;
	reservation: string;
	refresh: () => Promise<CheckInContext | null>;
	onDone: () => void;
}) {
	const g = ctx.guest;
	const [form, setForm] = useState({
		id_type: (g?.id_type ?? "") as string,
		id_number: g?.id_number ?? "",
		id_expiry: g?.id_expiry ?? "",
		id_document: g?.id_document ?? "",
		id_name: g?.id_name ?? "",
		date_of_birth: g?.date_of_birth ?? "",
		nationality: g?.nationality ?? "Indian",
		address: g?.address ?? "",
	});
	const [busy, setBusy] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [overrideReason, setOverrideReason] = useState("");
	const [showOverride, setShowOverride] = useState(false);
	const fileRef = useRef<HTMLInputElement | null>(null);

	const reservationName = ctx.name_match.reservation_name;
	const hint = nameMatchHint(form.id_name, reservationName);

	async function onFile(file: File) {
		setUploading(true);
		try {
			// KYC ID scans are PII — store privately (served only to a logged-in session).
			const up = await uploadConditionPhoto(file, true);
			setForm((f) => ({ ...f, id_document: up.file_url }));
			toast.success("ID document uploaded");
		} catch (error) {
			toast.error("Upload failed", { description: error instanceof Error ? error.message : undefined });
		} finally {
			setUploading(false);
		}
	}

	async function save() {
		if (!form.id_type || !form.id_number) {
			toast.error("ID type and number are required");
			return;
		}
		if (showOverride && !overrideReason.trim()) {
			toast.error("Enter a manager override reason to verify a mismatched ID");
			return;
		}
		setBusy(true);
		try {
			await saveGuestKyc(
				reservation,
				{
					id_type: form.id_type as IdType,
					id_number: form.id_number,
					id_expiry: form.id_expiry || undefined,
					id_document: form.id_document || undefined,
					id_name: form.id_name || undefined,
					date_of_birth: form.date_of_birth || undefined,
					nationality: form.nationality || undefined,
					address: form.address || undefined,
				},
				true,
				overrideReason.trim() || undefined
			);
			toast.success("KYC verified");
			await refresh();
			onDone();
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Could not save KYC";
			// Name-mismatch block — reveal the override field instead of just erroring.
			if (/does not match|override/i.test(msg) && !overrideReason.trim()) {
				setShowOverride(true);
				toast.warning("Name on ID does not match the reservation", { description: "A manager override reason is required to verify." });
			} else {
				toast.error("Could not verify KYC", { description: msg });
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<StepCard>
			{g?.kyc_verified ? (
				<Badge className="w-fit gap-1"><BadgeCheck className="size-3.5" /> KYC verified</Badge>
			) : null}
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="ID type" required>
					<Select value={form.id_type} onValueChange={(v) => setForm({ ...form, id_type: v })}>
						<SelectTrigger data-testid="kyc-id-type"><SelectValue placeholder="Select" /></SelectTrigger>
						<SelectContent>{ID_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
					</Select>
				</Field>
				<Field label="ID number" required>
					<Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} data-testid="kyc-id-number" />
				</Field>
				<Field label="Name on ID" hint={`Must match the reservation: ${reservationName}`}>
					<Input value={form.id_name} onChange={(e) => setForm({ ...form, id_name: e.target.value })} placeholder={reservationName} data-testid="kyc-id-name" />
				</Field>
				<div className="flex items-end">
					<NameMatchChip hint={hint} hasInput={Boolean(form.id_name)} />
				</div>
				<Field label="ID expiry">
					<Input type="date" value={form.id_expiry} onChange={(e) => setForm({ ...form, id_expiry: e.target.value })} />
				</Field>
				<Field label="Date of birth">
					<Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
				</Field>
				<Field label="Nationality">
					<Input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
				</Field>
				<Field label="Address">
					<Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
				</Field>
			</div>

			<Field label="ID document" hint="Scan or photo of the physical ID">
				<div className="flex items-center gap-3">
					<input
						ref={fileRef}
						type="file"
						accept="image/*"
						className="hidden"
						onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
					/>
					<Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
						{uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload
					</Button>
					{form.id_document ? (
						<a href={form.id_document} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline">
							View uploaded document
						</a>
					) : <span className="text-xs text-muted-foreground">No document yet</span>}
				</div>
			</Field>

			{showOverride ? (
				<Field label="Manager override reason" required hint={`Name on ID does not match "${reservationName}". Document why this is being accepted.`}>
					<Input
						value={overrideReason}
						onChange={(e) => setOverrideReason(e.target.value)}
						placeholder="e.g. Spouse checking in; verified marriage certificate"
						data-testid="kyc-override"
					/>
				</Field>
			) : null}

			<div className="flex justify-end">
				<Button onClick={save} disabled={busy} data-testid="kyc-save">
					{busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
					{showOverride ? "Override & verify ID" : "Save & verify ID"}
				</Button>
			</div>
		</StepCard>
	);
}

// Lightweight client-side name-match hint (server enforces authoritatively).
function nameMatchHint(idName: string, reservationName: string): { score: number; status: NameMatchStatus } {
	const norm = (s: string) =>
		s.toLowerCase().replace(/\b(mr|mrs|ms|dr|shri|smt|kum)\.?\b/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).sort();
	const a = norm(idName);
	const b = norm(reservationName);
	if (!a.length || !b.length) return { score: 0, status: "review" };
	const setA = new Set(a);
	const setB = new Set(b);
	const inter = [...setA].filter((t) => setB.has(t)).length;
	const union = new Set([...setA, ...setB]).size;
	const score = Math.round((inter / union) * 100);
	const status: NameMatchStatus = score >= 80 ? "match" : score >= 60 ? "review" : "mismatch";
	return { score, status };
}

function NameMatchChip({ hint, hasInput }: { hint: { score: number; status: NameMatchStatus }; hasInput: boolean }) {
	if (!hasInput) return <span className="text-xs text-muted-foreground">Enter the name as printed on the ID</span>;
	const tone =
		hint.status === "match"
			? "border-success/40 bg-success/10 text-success"
			: hint.status === "review"
				? "border-warning/40 bg-warning/10 text-warning"
				: "border-destructive/40 bg-destructive/10 text-destructive";
	const label = hint.status === "match" ? "Matches reservation" : hint.status === "review" ? "Partial match — check" : "Does not match";
	return (
		<span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${tone}`} data-testid="name-match-chip">
			{hint.status === "match" ? <BadgeCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
			{label} · {hint.score}%
		</span>
	);
}

// ---------- step 1: registration card ----------

function RegistrationStep({
	ctx,
	reservation,
	refresh,
	onDone,
}: {
	ctx: CheckInContext;
	reservation: string;
	refresh: () => Promise<CheckInContext | null>;
	onDone: () => void;
}) {
	const c = ctx.registration_card;
	const [form, setForm] = useState({
		guest_full_name: c?.guest_full_name ?? ctx.guest?.guest_full_name ?? "",
		purpose_of_visit: (c?.purpose_of_visit ?? "Leisure") as string,
		arrival_from: c?.arrival_from ?? "",
		vehicle_number: c?.vehicle_number ?? "",
		expected_departure: c?.expected_departure ?? ctx.departure_date ?? "",
		adults: String(c?.adults ?? 2),
		children: String(c?.children ?? 0),
	});
	const [signature, setSignature] = useState(c?.signature ?? "");
	const [terms, setTerms] = useState(Boolean(c?.terms_accepted));
	const [busy, setBusy] = useState(false);

	async function save() {
		if (!terms || !signature) {
			toast.error("Accept the terms and capture the guest signature");
			return;
		}
		setBusy(true);
		try {
			await saveRegistrationCard(reservation, {
				guest_full_name: form.guest_full_name || undefined,
				purpose_of_visit: form.purpose_of_visit as PurposeOfVisit,
				arrival_from: form.arrival_from || undefined,
				vehicle_number: form.vehicle_number || undefined,
				expected_departure: form.expected_departure || undefined,
				adults: Number(form.adults) || undefined,
				children: Number(form.children) || 0,
				signature,
				terms_accepted: terms,
			});
			toast.success("Registration card signed");
			await refresh();
			onDone();
		} catch (error) {
			toast.error("Could not save registration", { description: error instanceof Error ? error.message : undefined });
		} finally {
			setBusy(false);
		}
	}

	return (
		<StepCard>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="Guest name" required>
					<Input value={form.guest_full_name} onChange={(e) => setForm({ ...form, guest_full_name: e.target.value })} />
				</Field>
				<Field label="Purpose of visit">
					<Select value={form.purpose_of_visit} onValueChange={(v) => setForm({ ...form, purpose_of_visit: v })}>
						<SelectTrigger><SelectValue /></SelectTrigger>
						<SelectContent>{PURPOSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
					</Select>
				</Field>
				<Field label="Arriving from">
					<Input value={form.arrival_from} onChange={(e) => setForm({ ...form, arrival_from: e.target.value })} placeholder="City" />
				</Field>
				<Field label="Vehicle number">
					<Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} placeholder="TN-01-AB-1234" />
				</Field>
				<Field label="Expected departure">
					<Input type="date" value={form.expected_departure} onChange={(e) => setForm({ ...form, expected_departure: e.target.value })} />
				</Field>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Adults"><Input type="number" min="1" value={form.adults} onChange={(e) => setForm({ ...form, adults: e.target.value })} /></Field>
					<Field label="Children"><Input type="number" min="0" value={form.children} onChange={(e) => setForm({ ...form, children: e.target.value })} /></Field>
				</div>
			</div>

			<Field label="Guest signature" required>
				<SignaturePad value={signature} onChange={setSignature} />
			</Field>

			<label className="flex items-center gap-2 text-sm">
				<Checkbox checked={terms} onCheckedChange={(v) => setTerms(Boolean(v))} data-testid="reg-terms" />
				The guest accepts the resort terms, house rules, and privacy policy.
			</label>

			<div className="flex justify-end">
				<Button onClick={save} disabled={busy} data-testid="reg-save">
					{busy ? <Loader2 className="size-4 animate-spin" /> : <FileSignature className="size-4" />} Save registration
				</Button>
			</div>
		</StepCard>
	);
}

// ---------- step 2: room assignment ----------

function RoomStep({
	ctx,
	selectedRoom,
	setSelectedRoom,
	onDone,
}: {
	ctx: CheckInContext;
	selectedRoom: string | null;
	setSelectedRoom: (name: string) => void;
	onDone: () => void;
}) {
	const assigned = ctx.stay?.current_room ?? null;
	const room = selectedRoom ?? assigned ?? ctx.available_rooms[0]?.name ?? null;

	// Seed the parent's selection from the first available villa once.
	useEffect(() => {
		if (!selectedRoom && room) setSelectedRoom(room);
	}, [selectedRoom, room, setSelectedRoom]);

	if (assigned) {
		return (
			<StepCard>
				<Badge className="w-fit gap-1"><Check className="size-3.5" /> Assigned: {assigned}</Badge>
				<RoomReadinessCard room={assigned} />
				<div className="flex justify-end"><Button onClick={onDone}>Continue</Button></div>
			</StepCard>
		);
	}

	return (
		<StepCard>
			{ctx.available_rooms.length === 0 ? (
				<p className="text-sm text-destructive">No vacant, sellable villa is available for this room type.</p>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{ctx.available_rooms.map((rm) => {
						const active = room === rm.name;
						return (
							<button
								key={rm.name}
								type="button"
								onClick={() => setSelectedRoom(rm.name)}
								className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
									active ? "border-foreground bg-muted" : "border-border hover:border-foreground/40"
								}`}
								data-testid={`room-${rm.room_number}`}
							>
								<span>
									<span className="font-medium">{rm.room_name ?? rm.room_number}</span>
									<span className="ml-2 text-muted-foreground">{rm.room_number}</span>
								</span>
								{active ? <Check className="size-4" /> : null}
								<span className="text-xs text-muted-foreground">{rm.housekeeping_status}</span>
							</button>
						);
					})}
				</div>
			)}
			{room ? <RoomReadinessCard room={room} /> : null}
			<div className="flex justify-end">
				<Button onClick={onDone} disabled={!room} data-testid="room-continue"><DoorOpen className="size-4" /> Assign &amp; continue</Button>
			</div>
		</StepCard>
	);
}

// ---------- step 3: deposit (optional) ----------

function DepositStep({
	ctx,
	reservation,
	refresh,
	onDone,
}: {
	ctx: CheckInContext;
	reservation: string;
	refresh: () => Promise<CheckInContext | null>;
	onDone: () => void;
}) {
	const [amount, setAmount] = useState("");
	const [mode, setMode] = useState("Razorpay (card / UPI)");
	const [busy, setBusy] = useState(false);

	async function take() {
		const amt = parseFloat(amount);
		if (!amt || amt <= 0) {
			toast.error("Enter a deposit amount");
			return;
		}
		setBusy(true);
		try {
			let folio = ctx.folio;
			if (!folio) {
				const opened = await getOrCreateFolio({ reservation });
				folio = opened.data?.folio?.name ?? null;
			}
			if (!folio) throw new Error("Could not open a folio for the deposit");
			if (mode === "Razorpay (card / UPI)") {
				await payDepositViaRazorpay({
					guest_folio: folio,
					amount: amt,
					guestName: ctx.guest?.guest_full_name ?? undefined,
					guestEmail: ctx.guest?.email,
					guestPhone: ctx.guest?.phone,
				});
			} else {
				await recordDeposit({ guest_folio: folio, amount: amt, mode_of_payment: mode });
			}
			toast.success(`Deposit of ${rupees(amt)} recorded`);
			setAmount("");
			await refresh();
		} catch (error) {
			const msg = error instanceof Error ? error.message : undefined;
			if (msg === "Payment cancelled") {
				toast.info("Payment cancelled");
			} else {
				toast.error("Deposit failed", { description: msg });
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<StepCard>
			{ctx.deposit && ctx.deposit.deposit_total > 0 ? (
				<Badge className="w-fit gap-1"><Check className="size-3.5" /> {rupees(ctx.deposit.deposit_total)} on deposit</Badge>
			) : (
				<p className="text-sm text-muted-foreground">Optional — take an advance against the folio. A real Payment Entry is posted.</p>
			)}
			<div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
				<Field label="Amount (₹)">
					<Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" data-testid="deposit-amount" />
				</Field>
				<Field label="Mode">
					<Select value={mode} onValueChange={setMode}>
						<SelectTrigger><SelectValue /></SelectTrigger>
						<SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
					</Select>
				</Field>
				<Button variant="outline" onClick={take} disabled={busy} data-testid="deposit-take">
					{busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />} Record
				</Button>
			</div>
			<div className="flex justify-end">
				<Button onClick={onDone}>Continue</Button>
			</div>
		</StepCard>
	);
}

// ---------- step 4: finalize ----------

function FinalizeStep({
	ctx,
	reservation,
	room,
	refresh,
	onDone,
}: {
	ctx: CheckInContext;
	reservation: string;
	room: string | null;
	refresh: () => Promise<CheckInContext | null>;
	onDone: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const checks = [
		{ label: "ID / KYC verified", ok: ctx.readiness.kyc },
		{ label: "Registration card signed", ok: ctx.readiness.registration },
		{ label: "Villa available", ok: ctx.readiness.room_selected },
	];

	async function finalize() {
		setBusy(true);
		try {
			const result = await finalizeCheckIn({ reservation, room: room ?? undefined });
			toast.success("Checked in", {
				description: `${ctx.guest?.guest_full_name ?? "Guest"} · room ${result.current_room ?? "—"}`,
			});
			await refresh();
			onDone();
		} catch (error) {
			toast.error("Check-in blocked", { description: error instanceof Error ? error.message : undefined });
		} finally {
			setBusy(false);
		}
	}

	async function printWelcomeCard() {
		try {
			const { printStayLabel } = await import("@/lib/print-label");
			await printStayLabel({
				type: "CHECKIN",
				folio: {
					name: ctx.folio ?? "—",
					total_charges: ctx.deposit?.total_charges ?? 0,
					total_taxes_estimated: 0,
					total_paid: ctx.deposit?.total_paid ?? 0,
					outstanding_amount: ctx.deposit?.outstanding_amount ?? 0,
					currency: "INR",
					folio_status: "Active",
				},
				stay: {
					name: ctx.stay?.name ?? null,
					stay_status: ctx.stay?.stay_status ?? "In House",
					current_room: ctx.stay?.current_room ?? null,
					arrival_date: ctx.arrival_date ?? null,
					departure_date: ctx.departure_date ?? null,
				},
				reservation: { name: ctx.reservation, status: ctx.status, booking_source: null },
				guest: {
					name: ctx.guest?.guest_full_name ?? "Guest",
					email: ctx.guest?.email ?? null,
					phone: ctx.guest?.phone ?? null,
				},
				property: ctx.resort_property,
				company: "THE REEZORT Private Limited",
				timestamp: new Date().toISOString(),
			});
			toast.success("Welcome card downloaded");
		} catch (error) {
			toast.error("Could not print card", { description: error instanceof Error ? error.message : undefined });
		}
	}

	if (ctx.stay) {
		return (
			<StepCard>
				<Badge className="w-fit gap-1"><BadgeCheck className="size-3.5" /> Checked in — {ctx.stay.current_room}</Badge>
				<p className="text-sm text-muted-foreground">Print the welcome card for the guest — QR-encoded reference, room number, and folio ID for reception.</p>
				<div className="flex flex-wrap justify-end gap-2">
					<Button variant="outline" onClick={printWelcomeCard} data-testid="checkin-print-welcome">
						<Printer className="size-4" /> Print welcome card
					</Button>
					<Button variant="outline" onClick={() => ctx.folio && go(`#/folio/${encodeURIComponent(ctx.folio)}`)}>Open folio</Button>
					<Button onClick={onDone}>Capture condition photos</Button>
				</div>
			</StepCard>
		);
	}

	return (
		<StepCard>
			<ul className="flex flex-col gap-2 text-sm">
				{checks.map((c) => (
					<li key={c.label} className="flex items-center gap-2">
						<span className={`flex size-5 items-center justify-center rounded-full ${c.ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
							<Check className="size-3.5" />
						</span>
						<span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
					</li>
				))}
			</ul>
			<p className="text-xs text-muted-foreground">A signed registration card and verified KYC are required by law before the guest may occupy the room.</p>
			<div className="flex justify-end">
				<Button onClick={finalize} disabled={busy || !ctx.readiness.can_finalize} data-testid="checkin-finalize">
					{busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Finalize check-in
				</Button>
			</div>
		</StepCard>
	);
}

// ---------- step 5: before-stay condition photos ----------

function PhotosStep({ ctx }: { ctx: CheckInContext }) {
	if (!ctx.stay) {
		return <StepCard><p className="text-sm text-muted-foreground">Finalize check-in first to capture room-condition photos.</p></StepCard>;
	}
	return (
		<div className="flex flex-col gap-4">
			<ConditionCaptureScreen stay={ctx.stay.name} />
			<div className="flex justify-end">
				<Button onClick={() => ctx.folio && go(`#/folio/${encodeURIComponent(ctx.folio)}`)} data-testid="checkin-done">
					Finish — open folio
				</Button>
			</div>
		</div>
	);
}
