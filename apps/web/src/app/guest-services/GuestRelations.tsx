/**
 * Guest Relations console — Module 010.
 * Surfaces Guest Requests, Guest Complaints, and Service Recovery actions.
 * Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { useFrappeAuth } from "frappe-react-sdk";
import {
	AlarmClock,
	AlertTriangle,
	CheckCircle2,
	Loader2,
	MessageSquareWarning,
	Plus,
	RefreshCw,
	UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Field } from "@/components/workspace/field";
import { listSetupOptions, type PropertyOption } from "@/lib/setup-api";
import {
	FolioApiError,
	assignGuestRequest,
	createComplaint,
	createGuestRequest,
	createServiceHandoff,
	getServiceConsole,
	proposeServiceRecovery,
	updateComplaintStatus,
	updateGuestRequestStatus,
	type ComplaintCategory,
	type ComplaintSeverity,
	type ComplaintStatus,
	type GuestComplaint,
	type GuestRequest,
	type GuestRequestPriority,
	type GuestRequestStatus,
	type HandoffTargetModule,
	type RecoveryType,
	type ServiceConsole,
	type ServiceDepartment,
} from "@/lib/guest-services-api";

// ─── helpers ───────────────────────────────────────────────────────────────

function reportError(error: unknown, fallback: string) {
	const detail =
		error instanceof FolioApiError
			? (error.blockers[0]?.message ?? error.message)
			: String(error);
	toast.error(fallback, { description: detail });
}

const REQUEST_STATUSES: GuestRequestStatus[] = [
	"New",
	"Acknowledged",
	"Assigned",
	"In Progress",
	"Waiting for Guest",
	"Waiting for Department",
	"Waiting for Vendor",
	"Escalated",
	"Completed",
	"Verified",
	"Reopened",
	"Closed",
	"Cancelled",
];

const COMPLAINT_STATUSES: ComplaintStatus[] = [
	"Open",
	"Acknowledged",
	"Investigating",
	"Waiting for Guest",
	"Waiting for Department",
	"Recovery Proposed",
	"Recovery Approved",
	"Resolved",
	"Reopened",
	"Escalated",
	"Closed",
];

const DEPARTMENTS: ServiceDepartment[] = [
	"Front Desk",
	"Concierge",
	"Housekeeping",
	"Maintenance",
	"F&B",
	"Events",
	"Billing",
	"Security",
	"Transport",
	"Other",
];

const PRIORITIES: GuestRequestPriority[] = ["Low", "Normal", "High", "Urgent", "VIP", "Safety"];

const COMPLAINT_CATEGORIES: ComplaintCategory[] = [
	"Room",
	"Housekeeping",
	"Maintenance",
	"F&B",
	"Billing",
	"Staff",
	"Noise",
	"Safety",
	"Delay",
	"Event",
	"Other",
];

const COMPLAINT_SEVERITIES: ComplaintSeverity[] = ["Low", "Medium", "High", "Critical"];

const RECOVERY_TYPES: RecoveryType[] = [
	"Apology",
	"Amenity",
	"Room Move",
	"Complimentary Item",
	"Discount",
	"Refund Request",
	"Loyalty Credit",
	"Manager Call",
	"Other",
];

const HANDOFF_MODULES: HandoffTargetModule[] = [
	"Housekeeping",
	"Maintenance",
	"F&B",
	"Billing",
	"Events",
	"Integrations",
	"Security",
	"Spa Parked",
];

const PRIORITY_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
	Safety: "destructive",
	VIP: "destructive",
	Urgent: "destructive",
	High: "destructive",
	Normal: "secondary",
	Low: "outline",
};

const SEVERITY_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
	Critical: "destructive",
	High: "destructive",
	Medium: "secondary",
	Low: "outline",
};

function slaChip(due: string | null): { text: string; danger: boolean } | null {
	if (!due) return null;
	const ms = new Date(due).getTime() - Date.now();
	const mins = Math.round(ms / 60000);
	if (mins < 0) return { text: "Overdue", danger: true };
	if (mins >= 60) return { text: `${Math.floor(mins / 60)}h ${mins % 60}m`, danger: false };
	return { text: `${mins}m left`, danger: mins <= 15 };
}

// ─── main screen ──────────────────────────────────────────────────────────

type Tab = "requests" | "complaints";

export default function GuestRelations() {
	const { currentUser } = useFrappeAuth();
	const [tab, setTab] = useState<Tab>("requests");
	const [console_, setConsole] = useState<ServiceConsole | null>(null);
	const [properties, setProperties] = useState<PropertyOption[]>([]);
	const [selectedProperty, setSelectedProperty] = useState<string>("");
	const [loading, setLoading] = useState(true);
	const [denied, setDenied] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);

	// sheet states
	const [creatingRequest, setCreatingRequest] = useState(false);
	const [creatingComplaint, setCreatingComplaint] = useState(false);
	const [recoveryTarget, setRecoveryTarget] = useState<GuestComplaint | null>(null);
	const [handoffSource, setHandoffSource] = useState<{
		doctype: string;
		name: string;
	} | null>(null);

	useEffect(() => {
		listSetupOptions()
			.then((o) => {
				setProperties(o.properties);
				if (o.properties[0]) setSelectedProperty(o.properties[0].name);
			})
			.catch(() => {});
	}, []);

	const reload = useCallback(async () => {
		if (!selectedProperty) return;
		setLoading(true);
		try {
			setConsole(await getServiceConsole(selectedProperty));
		} catch (error) {
			if (error instanceof FolioApiError && error.status === 403) setDenied(true);
			else reportError(error, "Could not load guest relations console");
		} finally {
			setLoading(false);
		}
	}, [selectedProperty]);

	useEffect(() => {
		reload();
	}, [reload]);

	async function actRequest(
		name: string,
		fn: () => Promise<unknown>,
		success: string
	) {
		setBusy(name);
		try {
			await fn();
			toast.success(success);
			await reload();
		} catch (error) {
			reportError(error, "Action failed");
		} finally {
			setBusy(null);
		}
	}

	const counts = console_?.counts;

	return (
		<main
			className="flex flex-1 flex-col gap-6  px-4 py-6 lg:px-6"
			data-testid="guest-relations-screen"
		>
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<Badge variant="outline" className="mb-2">
						Guest relations
					</Badge>
					<h1 className="text-3xl font-light text-foreground md:text-4xl">
						Guest relations
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Guest requests, complaints, and service recovery in one place.
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{properties.length > 1 ? (
						<Select value={selectedProperty} onValueChange={setSelectedProperty}>
							<SelectTrigger className="w-48">
								<SelectValue placeholder="Property" />
							</SelectTrigger>
							<SelectContent>
								{properties.map((p) => (
									<SelectItem key={p.name} value={p.name}>
										{p.property_name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : null}

					<Button
						variant="outline"
						size="icon"
						aria-label="Refresh"
						onClick={reload}
						disabled={loading}
					>
						<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
					</Button>

					<Button
						onClick={() =>
							tab === "requests"
								? setCreatingRequest(true)
								: setCreatingComplaint(true)
						}
						disabled={denied || !selectedProperty}
						data-testid="new-item-btn"
					>
						<Plus className="size-4" />
						{tab === "requests" ? "New request" : "New complaint"}
					</Button>
				</div>
			</header>

			{/* Counts row */}
			{counts ? (
				<div className="flex flex-wrap gap-2" data-testid="counts-row">
					{counts.open_requests > 0 ? (
						<Badge variant="secondary">{counts.open_requests} open requests</Badge>
					) : null}
					{counts.open_complaints > 0 ? (
						<Badge variant="secondary">{counts.open_complaints} open complaints</Badge>
					) : null}
					{counts.sla_exceptions > 0 ? (
						<Badge variant="destructive" className="gap-1">
							<AlarmClock className="size-3.5" />
							{counts.sla_exceptions} SLA exceptions
						</Badge>
					) : null}
				</div>
			) : null}

			{/* Tabs */}
			<div className="flex gap-1 border-b">
				{(["requests", "complaints"] as Tab[]).map((t) => (
					<button
						key={t}
						onClick={() => setTab(t)}
						className={`px-4 py-2 text-sm capitalize transition-colors ${
							tab === t
								? "border-b-2 border-foreground font-medium text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
						data-testid={`tab-${t}`}
					>
						{t}
					</button>
				))}
			</div>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : denied ? (
				<Card>
					<CardContent className="py-8 text-sm text-muted-foreground">
						You do not have permission to view guest relations.
					</CardContent>
				</Card>
			) : tab === "requests" ? (
				<RequestsTable
					requests={console_?.requests ?? []}
					busy={busy}
					currentUser={currentUser ?? null}
					onStatusChange={(name, status) =>
						actRequest(name, () => updateGuestRequestStatus(name, status), `Set ${status}`)
					}
					onAssign={(name) =>
						actRequest(
							name,
							() => assignGuestRequest(name, currentUser!),
							"Assigned to you"
						)
					}
					onHandoff={(name) =>
						setHandoffSource({ doctype: "Guest Request", name })
					}
				/>
			) : (
				<ComplaintsTable
					complaints={console_?.complaints ?? []}
					busy={busy}
					onStatusChange={(name, status) =>
						actRequest(name, () => updateComplaintStatus(name, status), `Set ${status}`)
					}
					onProposeRecovery={(complaint) => setRecoveryTarget(complaint)}
					onHandoff={(name) =>
						setHandoffSource({ doctype: "Guest Complaint", name })
					}
				/>
			)}

			{/* Sheets */}
			{creatingRequest ? (
				<NewRequestSheet
					property={selectedProperty}
					onClose={() => setCreatingRequest(false)}
					onCreated={reload}
				/>
			) : null}

			{creatingComplaint ? (
				<NewComplaintSheet
					property={selectedProperty}
					onClose={() => setCreatingComplaint(false)}
					onCreated={reload}
				/>
			) : null}

			{recoveryTarget ? (
				<ProposeRecoverySheet
					complaint={recoveryTarget}
					onClose={() => setRecoveryTarget(null)}
					onCreated={reload}
				/>
			) : null}

			{handoffSource ? (
				<CreateHandoffSheet
					source={handoffSource}
					onClose={() => setHandoffSource(null)}
					onCreated={reload}
				/>
			) : null}
		</main>
	);
}

// ─── Requests table ───────────────────────────────────────────────────────

function RequestsTable({
	requests,
	busy,
	currentUser,
	onStatusChange,
	onAssign,
	onHandoff,
}: {
	requests: GuestRequest[];
	busy: string | null;
	currentUser: string | null;
	onStatusChange: (name: string, status: GuestRequestStatus) => void;
	onAssign: (name: string) => void;
	onHandoff: (name: string) => void;
}) {
	return (
		<div className="rounded-lg border" data-testid="requests-table">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Request</TableHead>
						<TableHead>Type / Dept</TableHead>
						<TableHead>Priority</TableHead>
						<TableHead>SLA</TableHead>
						<TableHead>Assignee</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{requests.length === 0 ? (
						<TableRow>
							<TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
								No open requests.
							</TableCell>
						</TableRow>
					) : null}
					{requests.map((r) => {
						const sla = slaChip(r.response_due_at);
						return (
							<TableRow key={r.name} data-testid={`req-${r.name}`}>
								<TableCell>
									<div className="font-medium">{r.subject}</div>
									<div className="text-xs text-muted-foreground">
										{r.name}
										{r.room ? ` · ${r.room}` : ""}
									</div>
								</TableCell>
								<TableCell className="text-sm">
									<div>{r.request_type}</div>
									<div className="text-xs text-muted-foreground">{r.department}</div>
								</TableCell>
								<TableCell>
									<Badge variant={PRIORITY_VARIANT[r.priority] ?? "secondary"}>
										{r.priority}
									</Badge>
								</TableCell>
								<TableCell>
									{sla ? (
										<span
											className={`text-sm ${sla.danger ? "font-medium text-destructive" : "text-muted-foreground"}`}
										>
											{sla.danger ? <AlarmClock className="mr-1 inline size-3.5" /> : null}
											{sla.text}
										</span>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</TableCell>
								<TableCell className="text-sm">{r.assigned_to ?? "—"}</TableCell>
								<TableCell>
									<Select
										value={r.status}
										onValueChange={(s) => onStatusChange(r.name, s as GuestRequestStatus)}
										disabled={busy === r.name}
									>
										<SelectTrigger className="h-8 w-40" data-testid={`req-status-${r.name}`}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{REQUEST_STATUSES.map((s) => (
												<SelectItem key={s} value={s}>
													{s}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TableCell>
								<TableCell className="text-right">
									<div className="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											aria-label="Assign to me"
											disabled={busy === r.name || !currentUser}
											onClick={() => onAssign(r.name)}
										>
											{busy === r.name ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<UserPlus className="size-4" />
											)}
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label="Create handoff"
											disabled={busy === r.name}
											onClick={() => onHandoff(r.name)}
										>
											<CheckCircle2 className="size-4" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}

// ─── Complaints table ─────────────────────────────────────────────────────

function ComplaintsTable({
	complaints,
	busy,
	onStatusChange,
	onProposeRecovery,
	onHandoff,
}: {
	complaints: GuestComplaint[];
	busy: string | null;
	onStatusChange: (name: string, status: ComplaintStatus) => void;
	onProposeRecovery: (complaint: GuestComplaint) => void;
	onHandoff: (name: string) => void;
}) {
	return (
		<div className="rounded-lg border" data-testid="complaints-table">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Complaint</TableHead>
						<TableHead>Category</TableHead>
						<TableHead>Severity</TableHead>
						<TableHead>SLA</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{complaints.length === 0 ? (
						<TableRow>
							<TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
								No open complaints.
							</TableCell>
						</TableRow>
					) : null}
					{complaints.map((c) => {
						const sla = slaChip(c.response_due_at);
						return (
							<TableRow key={c.name} data-testid={`cmp-${c.name}`}>
								<TableCell>
									<div className="flex items-center gap-1 font-medium">
										{c.legal_or_safety_risk ? (
											<AlertTriangle className="size-3.5 text-destructive" />
										) : null}
										{c.complaint_summary}
									</div>
									<div className="text-xs text-muted-foreground">
										{c.name}
										{c.room ? ` · ${c.room}` : ""}
									</div>
								</TableCell>
								<TableCell className="text-sm">
									<div>{c.complaint_category}</div>
									<div className="text-xs text-muted-foreground">{c.department}</div>
								</TableCell>
								<TableCell>
									<Badge variant={SEVERITY_VARIANT[c.severity] ?? "secondary"}>
										{c.severity}
									</Badge>
								</TableCell>
								<TableCell>
									{sla ? (
										<span
											className={`text-sm ${sla.danger ? "font-medium text-destructive" : "text-muted-foreground"}`}
										>
											{sla.text}
										</span>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</TableCell>
								<TableCell>
									<Select
										value={c.status}
										onValueChange={(s) => onStatusChange(c.name, s as ComplaintStatus)}
										disabled={busy === c.name}
									>
										<SelectTrigger className="h-8 w-44" data-testid={`cmp-status-${c.name}`}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{COMPLAINT_STATUSES.map((s) => (
												<SelectItem key={s} value={s}>
													{s}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TableCell>
								<TableCell className="text-right">
									<div className="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											aria-label="Propose recovery"
											disabled={busy === c.name}
											onClick={() => onProposeRecovery(c)}
										>
											{busy === c.name ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<MessageSquareWarning className="size-4" />
											)}
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label="Create handoff"
											disabled={busy === c.name}
											onClick={() => onHandoff(c.name)}
										>
											<CheckCircle2 className="size-4" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}

// ─── New Request sheet ────────────────────────────────────────────────────

function NewRequestSheet({
	property,
	onClose,
	onCreated,
}: {
	property: string;
	onClose: () => void;
	onCreated: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [form, setForm] = useState({
		request_type: "",
		subject: "",
		department: "Front Desk" as ServiceDepartment,
		priority: "Normal" as GuestRequestPriority,
		room: "",
		guest_visible_notes: "",
	});

	function patch<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
		setForm((f) => ({ ...f, [k]: v }));
	}

	async function save() {
		setBusy(true);
		try {
			const result = await createGuestRequest({
				property,
				request_type: form.request_type,
				subject: form.subject,
				department: form.department,
				priority: form.priority,
				room: form.room || undefined,
				guest_visible_notes: form.guest_visible_notes || undefined,
				source: "Staff",
			});
			if (result.guest_request) {
				toast.success(`Request ${result.guest_request} created`);
			}
			onCreated();
			onClose();
		} catch (error) {
			if (error instanceof FolioApiError && error.warnings.length) {
				toast.warning("Created with warning", {
					description: error.warnings[0]?.message,
				});
				onCreated();
				onClose();
			} else {
				reportError(error, "Could not create request");
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent
				className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
				data-testid="new-request-sheet"
			>
				<SheetHeader>
					<SheetTitle>New guest request</SheetTitle>
					<SheetDescription>Log a request for a guest or room.</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 py-4">
					<Field label="Request type code">
						<Input
							value={form.request_type}
							onChange={(e) => patch("request_type", e.target.value)}
							placeholder="e.g. EXTRA_TOWELS"
							data-testid="req-type"
						/>
					</Field>
					<Field label="Subject">
						<Input
							value={form.subject}
							onChange={(e) => patch("subject", e.target.value)}
							placeholder="Brief description"
							data-testid="req-subject"
						/>
					</Field>
					<div className="grid grid-cols-2 gap-3">
						<Field label="Department">
							<Select
								value={form.department}
								onValueChange={(v) => patch("department", v as ServiceDepartment)}
							>
								<SelectTrigger data-testid="req-dept">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DEPARTMENTS.map((d) => (
										<SelectItem key={d} value={d}>
											{d}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<Field label="Priority">
							<Select
								value={form.priority}
								onValueChange={(v) => patch("priority", v as GuestRequestPriority)}
							>
								<SelectTrigger data-testid="req-priority">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PRIORITIES.map((p) => (
										<SelectItem key={p} value={p}>
											{p}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</div>
					<Field label="Room (optional)">
						<Input
							value={form.room}
							onChange={(e) => patch("room", e.target.value)}
							placeholder="e.g. 204"
							data-testid="req-room"
						/>
					</Field>
					<Field label="Notes for guest (optional)">
						<textarea
							value={form.guest_visible_notes}
							onChange={(e) => patch("guest_visible_notes", e.target.value)}
							rows={3}
							className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						/>
					</Field>
				</div>
				<SheetFooter>
					<Button
						onClick={save}
						disabled={busy || !form.request_type || !form.subject}
						data-testid="req-save"
					>
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Create request
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ─── New Complaint sheet ──────────────────────────────────────────────────

function NewComplaintSheet({
	property,
	onClose,
	onCreated,
}: {
	property: string;
	onClose: () => void;
	onCreated: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [form, setForm] = useState({
		category: "Room" as ComplaintCategory,
		severity: "Medium" as ComplaintSeverity,
		summary: "",
		details: "",
		desired_resolution: "",
		room: "",
		legal_or_safety_risk: false,
	});

	function patch<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
		setForm((f) => ({ ...f, [k]: v }));
	}

	async function save() {
		setBusy(true);
		try {
			const result = await createComplaint({
				property,
				category: form.category,
				severity: form.severity,
				summary: form.summary,
				details: form.details,
				desired_resolution: form.desired_resolution || undefined,
				room: form.room || undefined,
				legal_or_safety_risk: form.legal_or_safety_risk,
			});
			const msg = result.escalated
				? `Complaint ${result.guest_complaint} raised — auto-escalated (legal/safety flag)`
				: `Complaint ${result.guest_complaint} raised`;
			toast.success(msg);
			onCreated();
			onClose();
		} catch (error) {
			reportError(error, "Could not create complaint");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent
				className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
				data-testid="new-complaint-sheet"
			>
				<SheetHeader>
					<SheetTitle>New complaint</SheetTitle>
					<SheetDescription>Log a guest complaint and begin resolution.</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 py-4">
					<div className="grid grid-cols-2 gap-3">
						<Field label="Category">
							<Select
								value={form.category}
								onValueChange={(v) => patch("category", v as ComplaintCategory)}
							>
								<SelectTrigger data-testid="cmp-category">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{COMPLAINT_CATEGORIES.map((c) => (
										<SelectItem key={c} value={c}>
											{c}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<Field label="Severity">
							<Select
								value={form.severity}
								onValueChange={(v) => patch("severity", v as ComplaintSeverity)}
							>
								<SelectTrigger data-testid="cmp-severity">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{COMPLAINT_SEVERITIES.map((s) => (
										<SelectItem key={s} value={s}>
											{s}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</div>
					<Field label="Summary">
						<Input
							value={form.summary}
							onChange={(e) => patch("summary", e.target.value)}
							placeholder="One-line summary"
							data-testid="cmp-summary"
						/>
					</Field>
					<Field label="Details">
						<textarea
							value={form.details}
							onChange={(e) => patch("details", e.target.value)}
							rows={4}
							placeholder="Full description of the complaint"
							className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							data-testid="cmp-details"
						/>
					</Field>
					<Field label="Desired resolution (optional)">
						<Input
							value={form.desired_resolution}
							onChange={(e) => patch("desired_resolution", e.target.value)}
							placeholder="What the guest expects"
						/>
					</Field>
					<Field label="Room (optional)">
						<Input
							value={form.room}
							onChange={(e) => patch("room", e.target.value)}
							placeholder="e.g. 301"
						/>
					</Field>
					<label className="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={form.legal_or_safety_risk}
							onChange={(e) => patch("legal_or_safety_risk", e.target.checked)}
							className="size-4"
							data-testid="cmp-legal"
						/>
						<span className="text-destructive font-medium">Legal or safety risk</span>
						<span className="text-muted-foreground">(auto-escalates)</span>
					</label>
				</div>
				<SheetFooter>
					<Button
						onClick={save}
						disabled={busy || !form.summary || !form.details}
						data-testid="cmp-save"
					>
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Raise complaint
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ─── Propose Recovery sheet ───────────────────────────────────────────────

function ProposeRecoverySheet({
	complaint,
	onClose,
	onCreated,
}: {
	complaint: GuestComplaint;
	onClose: () => void;
	onCreated: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [form, setForm] = useState({
		recovery_type: "Apology" as RecoveryType,
		estimated_value: "",
		reason: "",
		requires_billing_handoff: false,
	});

	function patch<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
		setForm((f) => ({ ...f, [k]: v }));
	}

	async function save() {
		setBusy(true);
		try {
			const result = await proposeServiceRecovery({
				guest_complaint: complaint.name,
				recovery_type: form.recovery_type,
				estimated_value: form.estimated_value
					? parseFloat(form.estimated_value)
					: undefined,
				reason: form.reason,
				requires_billing_handoff: form.requires_billing_handoff,
			});
			const msg = result.approval_required
				? `Recovery ${result.service_recovery_action} pending approval`
				: `Recovery ${result.service_recovery_action} created`;
			toast.success(msg);
			onCreated();
			onClose();
		} catch (error) {
			reportError(error, "Could not propose recovery");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent
				className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
				data-testid="recovery-sheet"
			>
				<SheetHeader>
					<SheetTitle>Propose service recovery</SheetTitle>
					<SheetDescription>
						For complaint: {complaint.complaint_summary} ({complaint.name})
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 py-4">
					<Field label="Recovery type">
						<Select
							value={form.recovery_type}
							onValueChange={(v) => patch("recovery_type", v as RecoveryType)}
						>
							<SelectTrigger data-testid="rec-type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{RECOVERY_TYPES.map((t) => (
									<SelectItem key={t} value={t}>
										{t}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field label="Estimated value (optional)">
						<Input
							type="number"
							value={form.estimated_value}
							onChange={(e) => patch("estimated_value", e.target.value)}
							placeholder="e.g. 2500"
							data-testid="rec-value"
						/>
					</Field>
					<Field label="Reason">
						<textarea
							value={form.reason}
							onChange={(e) => patch("reason", e.target.value)}
							rows={3}
							placeholder="Justify the recovery action"
							className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							data-testid="rec-reason"
						/>
					</Field>
					<label className="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={form.requires_billing_handoff}
							onChange={(e) => patch("requires_billing_handoff", e.target.checked)}
							className="size-4"
						/>
						<span>Route to billing after approval</span>
					</label>
					<p className="text-xs text-muted-foreground">
						Financial recovery types (Discount, Refund Request, Loyalty Credit, Complimentary
						Item) require approval before posting to billing.
					</p>
				</div>
				<SheetFooter>
					<Button
						onClick={save}
						disabled={busy || !form.reason}
						data-testid="rec-save"
					>
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Propose recovery
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ─── Create Handoff sheet ─────────────────────────────────────────────────

function CreateHandoffSheet({
	source,
	onClose,
	onCreated,
}: {
	source: { doctype: string; name: string };
	onClose: () => void;
	onCreated: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [targetModule, setTargetModule] = useState<HandoffTargetModule>("Maintenance");

	async function save() {
		setBusy(true);
		try {
			const result = await createServiceHandoff({
				source_doctype: source.doctype,
				source_name: source.name,
				target_module: targetModule,
			});
			toast.success(
				`Handoff ${result.service_handoff} created → ${targetModule} (${result.status})`
			);
			onCreated();
			onClose();
		} catch (error) {
			reportError(error, "Could not create handoff");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent
				className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-sm"
				data-testid="handoff-sheet"
			>
				<SheetHeader>
					<SheetTitle>Create service handoff</SheetTitle>
					<SheetDescription>
						Route {source.doctype} {source.name} to another module.
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 py-4">
					<Field label="Target module">
						<Select
							value={targetModule}
							onValueChange={(v) => setTargetModule(v as HandoffTargetModule)}
						>
							<SelectTrigger data-testid="handoff-module">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{HANDOFF_MODULES.map((m) => (
									<SelectItem key={m} value={m}>
										{m}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
				</div>
				<SheetFooter>
					<Button onClick={save} disabled={busy} data-testid="handoff-save">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Create handoff
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
