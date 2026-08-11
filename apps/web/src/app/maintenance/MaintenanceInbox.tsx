/**
 * MaintenanceInbox — #/maintenance (spec 009 first slice).
 *
 * Ticket inbox with status/priority/room/search filters, SLA-aware rows, and
 * per-row actions (Assign to me / Start / Resolve) driven by the ticket state.
 * Header launches the Report Issue sheet. Live-with-mock fallback.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace";
import { useFrappeAuth } from "frappe-react-sdk";
import { motion } from "motion/react";
import { AlertTriangle, Loader2, MessageSquarePlus, Plus, RefreshCw, Search, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
	SheetHeader,
	SheetTitle,
	SheetDescription,
	SheetFooter,
} from "@/components/ui/sheet";
import { EASE_OUT } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import { ReportIssueSheet } from "@/components/maintenance/report-issue-sheet";
import {
	addTicketNote,
	assignTicket,
	getPrimaryResortProperty,
	listTickets,
	transitionTicket,
	type MaintenanceState,
	type MaintenanceTicket,
	type TicketListResult,
} from "@/lib/maintenance-api";

import { priorityTone, relativeTime, shortRoom, slaLabel, stateTone } from "./maintenance-format";

type LoadState = "loading" | "live" | "error";

const STATUS_FILTERS = [
	"Open",
	"Reported",
	"Assigned",
	"In Progress",
	"Waiting for Parts",
	"On Hold",
	"Resolved",
	"Verification Required",
	"Released",
	"Closed",
	"All",
] as const;
const PRIORITY_FILTERS = ["Any", "Urgent", "High", "Normal", "Low"] as const;

export default function MaintenanceInbox() {
	const { currentUser } = useFrappeAuth();
	const [data, setData] = useState<TicketListResult | null>(null);
	const [state, setState] = useState<LoadState>("loading");
	const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("Open");
	const [priority, setPriority] = useState<(typeof PRIORITY_FILTERS)[number]>("Any");
	const [search, setSearch] = useState("");
	const [reportOpen, setReportOpen] = useState(false);
	const [busyRow, setBusyRow] = useState<string | null>(null);
	const [propertyName, setPropertyName] = useState<string | null>(null);
	const [noteTicket, setNoteTicket] = useState<MaintenanceTicket | null>(null);

	// Property for new tickets — the inbox may be empty (no ticket to derive
	// from), so resolve the real Resort Property once on mount (env-agnostic).
	useEffect(() => {
		getPrimaryResortProperty().then((p) => {
			if (p) setPropertyName(p);
		});
	}, []);

	const load = useCallback((quiet = false) => {
		if (!quiet) setState("loading");
		listTickets({
			state: status === "Open" || status === "All" ? undefined : status,
			priority: priority === "Any" ? undefined : priority,
			search: search.trim() || undefined,
			limit: 100,
		})
			.then((res) => {
				setData(res);
				setState("live");
			})
			.catch((error: unknown) => {
				if (error instanceof FolioApiError) {
					toast.error("Could not load tickets", { description: error.blockers[0]?.message ?? error.message });
					setData({ tickets: [], counts: {}, overdue: 0, categories: [], priorities: [] });
					setState("live");
					return;
				}
				setData(null);
				setState("error");
			});
	}, [status, priority, search]);

	useEffect(() => {
		const t = window.setTimeout(load, search ? 250 : 0);
		return () => window.clearTimeout(t);
	}, [load, search]);

	const resortProperty = data?.tickets[0]?.resort_property ?? propertyName ?? "RZ-DEMO";

	// "Open" is a client-side rollup of the open states.
	const rows = useMemo(() => {
		const all = data?.tickets ?? [];
		if (status !== "Open") return all;
		return all.filter((t) =>
			["Reported", "Assigned", "In Progress", "Waiting for Parts", "On Hold", "Verification Required"].includes(t.state),
		);
	}, [data, status]);

	async function act(fn: () => Promise<unknown>, ticket: MaintenanceTicket) {
		if (busyRow) return;
		setBusyRow(ticket.name);
		try {
			await fn();
			load(true);
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Action failed", { description: msg });
		} finally {
			setBusyRow(null);
		}
	}

	function startTicket(t: MaintenanceTicket) {
		if (!window.confirm(`Start "${t.subject}"? This assigns it to you if unassigned.`)) return;
		void act(() => transitionTicket(t.name, "In Progress").then(() => toast.success("Started")), t);
	}

	function resolveTicket(t: MaintenanceTicket) {
		const notes = window.prompt("Resolution notes (optional):", "") ?? undefined;
		void act(() => transitionTicket(t.name, "Resolved", notes).then(() => toast.success("Resolved")), t);
	}

	function assignToMe(t: MaintenanceTicket) {
		if (!currentUser) return;
		void act(() => assignTicket(t.name, currentUser).then(() => toast.success("Assigned to you")), t);
	}

	function holdTicket(t: MaintenanceTicket) {
		void act(() => transitionTicket(t.name, "On Hold").then(() => toast.success("Ticket on hold")), t);
	}

	function requestVerification(t: MaintenanceTicket) {
		void act(() => transitionTicket(t.name, "Verification Required").then(() => toast.success("Verification requested")), t);
	}

	function releaseTicket(t: MaintenanceTicket) {
		if (!window.confirm(`Release "${t.subject}"? Confirm the room is ready.`)) return;
		void act(() => transitionTicket(t.name, "Released").then(() => toast.success("Ticket released")), t);
	}

	function waitingForParts(t: MaintenanceTicket) {
		void act(() => transitionTicket(t.name, "Waiting for Parts").then(() => toast.success("Waiting for parts")), t);
	}

	function resumeTicket(t: MaintenanceTicket) {
		void act(() => transitionTicket(t.name, "In Progress").then(() => toast.success("Resumed")), t);
	}

	const counts = data?.counts ?? {};
	const openCount =
		(counts.Reported ?? 0) +
		(counts.Assigned ?? 0) +
		(counts["In Progress"] ?? 0) +
		(counts["Waiting for Parts"] ?? 0) +
		(counts["On Hold"] ?? 0) +
		(counts["Verification Required"] ?? 0);

	return (
		<WorkspacePage title="Maintenance inbox" subtitle="Reported faults awaiting triage.">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<Badge variant="outline">{state === "live" ? "Live" : state === "loading" ? "Loading" : "Couldn't load"}</Badge>
						<Badge variant="secondary">Maintenance</Badge>
					</div>
					<h1 className="font-display text-3xl font-light tracking-tight">Maintenance</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{openCount} open · {data?.overdue ?? 0} overdue
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" aria-label="Refresh" onClick={() => load()}>
						<RefreshCw className="size-4" />
					</Button>
					<Button className="bg-brass text-brass-foreground hover:bg-brass/90" onClick={() => setReportOpen(true)} data-testid="report-issue-open">
						<Plus className="mr-1.5 size-4" /> Report issue
					</Button>
				</div>
			</div>

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-2">
				<Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
					<SelectTrigger className="w-36" data-testid="filter-status"><SelectValue /></SelectTrigger>
					<SelectContent>
						{STATUS_FILTERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
					</SelectContent>
				</Select>
				<Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
					<SelectTrigger className="w-32" data-testid="filter-priority"><SelectValue /></SelectTrigger>
					<SelectContent>
						{PRIORITY_FILTERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
					</SelectContent>
				</Select>
				<div className="relative ml-auto w-full max-w-xs">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input className="pl-8" placeholder="Search subject, room…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="filter-search" />
				</div>
			</div>

			{state === "loading" ? (
				<div className="flex flex-col gap-3">
					{Array.from({ length: 4 }).map((_, i) => (
						<Skeleton key={i} className="h-20 w-full rounded-xl" />
					))}
				</div>
			) : state === "error" ? (
				<div className="flex flex-col items-center gap-3 py-16 text-center">
					<AlertTriangle className="size-7 text-destructive" />
					<p className="text-sm text-muted-foreground">Could not load maintenance tickets.</p>
					<Button variant="outline" onClick={() => load()}>
						<RefreshCw className="mr-1.5 size-4" /> Retry
					</Button>
				</div>
			) : rows.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
					<Wrench className="size-7 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">
						{search || status !== "Open" || priority !== "Any"
							? "No tickets match — clear filters."
							: "No maintenance tickets yet."}
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{rows.map((t, i) => (
						<motion.div
							key={t.name}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.3, ease: EASE_OUT, delay: Math.min(i * 0.04, 0.4) }}
						>
							<TicketRow
								ticket={t}
								busy={busyRow === t.name}
								currentUser={currentUser ?? null}
								onAssignToMe={() => assignToMe(t)}
								onStart={() => startTicket(t)}
								onResolve={() => resolveTicket(t)}
								onHold={() => holdTicket(t)}
								onWaitingForParts={() => waitingForParts(t)}
								onResume={() => resumeTicket(t)}
								onRequestVerification={() => requestVerification(t)}
								onRelease={() => releaseTicket(t)}
								onAddNote={() => setNoteTicket(t)}
							/>
						</motion.div>
					))}
				</div>
			)}

			<ReportIssueSheet
				open={reportOpen}
				onOpenChange={setReportOpen}
				resortProperty={resortProperty}
				onCreated={() => load(true)}
			/>

			<AddNoteSheet
				ticket={noteTicket}
				onClose={() => setNoteTicket(null)}
				onSaved={() => load(true)}
			/>
		</WorkspacePage>
	);
}

function TicketRow({
	ticket,
	busy,
	currentUser,
	onAssignToMe,
	onStart,
	onResolve,
	onHold,
	onWaitingForParts,
	onResume,
	onRequestVerification,
	onRelease,
	onAddNote,
}: {
	ticket: MaintenanceTicket;
	busy: boolean;
	currentUser: string | null;
	onAssignToMe: () => void;
	onStart: () => void;
	onResolve: () => void;
	onHold: () => void;
	onWaitingForParts: () => void;
	onResume: () => void;
	onRequestVerification: () => void;
	onRelease: () => void;
	onAddNote: () => void;
}) {
	const pt = priorityTone(ticket.priority);
	const st = stateTone(ticket.state);
	const overdue = ticket.is_overdue;

	return (
		<div
			className={`rounded-xl border bg-card p-4 transition-colors ${overdue ? "border-warning/50 bg-warning/5" : ""}`}
			data-testid={`ticket-${ticket.name}`}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						{ticket.room ? (
							<a href={`#/room/${encodeURIComponent(ticket.room)}`} className="font-mono text-sm font-medium hover:underline">
								{shortRoom(ticket.room)}
							</a>
						) : (
							<span className="text-sm font-medium text-muted-foreground">Common area</span>
						)}
						<span className="truncate text-sm font-medium">{ticket.subject}</span>
						<Badge variant="outline" className={`text-[10px] ${pt.badge}`}>{pt.label}</Badge>
						<Badge variant="outline" className={`text-[10px] ${st.badge}`}>{st.label}</Badge>
						{ticket.severity ? (
							<Badge variant="outline" className="text-[10px]">{ticket.severity}</Badge>
						) : null}
						{ticket.guest_impact ? (
							<Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-300">Guest</Badge>
						) : null}
						{ticket.safety_impact ? (
							<Badge variant="outline" className="text-[10px] border-destructive text-destructive">Safety</Badge>
						) : null}
						{ticket.revenue_blocking ? (
							<Badge variant="outline" className="text-[10px] border-orange-500 text-orange-700 dark:text-orange-300">Revenue</Badge>
						) : null}
						{overdue ? (
							<Badge variant="outline" className="gap-1 border-transparent bg-warning text-[10px] text-black">
								<AlertTriangle className="size-3" /> Overdue
							</Badge>
						) : null}
					</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
						<span>{ticket.category}</span>
						<span>· Reported {relativeTime(ticket.reported_at)}</span>
						<span>· by {ticket.raised_by}</span>
						<span>· {ticket.assigned_to ? `Assigned to ${ticket.assigned_to}` : "Unassigned"}</span>
						<span className={overdue ? "text-warning" : ""}>· SLA {slaLabel(ticket.minutes_remaining)}</span>
						{ticket.downtime ? (
							<span>· Downtime: <a href="#/maintenance/engineering" className="hover:underline">{ticket.downtime}</a></span>
						) : null}
					</div>
					{ticket.guest_safe_note ? (
						<div className="mt-1.5 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
							Guest note: {ticket.guest_safe_note}
						</div>
					) : null}
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-1.5">
					{!ticket.assigned_to && ["Reported", "Assigned"].includes(ticket.state) && currentUser ? (
						<Button size="sm" variant="outline" disabled={busy} onClick={onAssignToMe} data-testid={`assign-${ticket.name}`}>
							Assign to me
						</Button>
					) : null}
					{["Reported", "Assigned"].includes(ticket.state) ? (
						<Button size="sm" disabled={busy} onClick={onStart} data-testid={`start-${ticket.name}`}>
							{busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}Start
						</Button>
					) : null}
					{ticket.state === "In Progress" ? (
						<>
							<Button size="sm" variant="outline" disabled={busy} onClick={onHold} data-testid={`hold-${ticket.name}`}>
								Hold
							</Button>
							<Button size="sm" variant="outline" disabled={busy} onClick={onWaitingForParts} data-testid={`parts-${ticket.name}`}>
								Waiting parts
							</Button>
							<Button size="sm" disabled={busy} onClick={onResolve} data-testid={`resolve-${ticket.name}`}>
								{busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}Resolve
							</Button>
						</>
					) : null}
					{["On Hold", "Waiting for Parts"].includes(ticket.state) ? (
						<Button size="sm" disabled={busy} onClick={onResume} data-testid={`resume-${ticket.name}`}>
							{busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}Resume
						</Button>
					) : null}
					{ticket.state === "Resolved" ? (
						<Button size="sm" variant="outline" disabled={busy} onClick={onRequestVerification} data-testid={`verify-req-${ticket.name}`}>
							Request verification
						</Button>
					) : null}
					{ticket.state === "Verification Required" ? (
						<Button size="sm" disabled={busy} onClick={onRelease} data-testid={`release-${ticket.name}`}>
							{busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}Release
						</Button>
					) : null}
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={onAddNote}
						aria-label="Add note"
						data-testid={`note-${ticket.name}`}
					>
						<MessageSquarePlus className="size-3.5" />
					</Button>
				</div>
			</div>
		</div>
	);
}

// ---------- AddNoteSheet ----------

function AddNoteSheet({
	ticket,
	onClose,
	onSaved,
}: {
	ticket: MaintenanceTicket | null;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [note, setNote] = useState("");
	const [visibility, setVisibility] = useState<"Internal" | "Guest Safe">("Internal");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (ticket) {
			setNote("");
			setVisibility("Internal");
			setBusy(false);
		}
	}, [ticket]);

	async function submit() {
		if (!ticket || !note.trim()) {
			toast.error("Note cannot be empty");
			return;
		}
		setBusy(true);
		try {
			await addTicketNote(ticket.name, note.trim(), visibility);
			toast.success("Note added");
			onClose();
			onSaved();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not add note", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={!!ticket} onOpenChange={(v) => { if (!v) onClose(); }}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="add-note-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<MessageSquarePlus className="size-4" /> Add note
					</SheetTitle>
					<SheetDescription>
						{ticket?.name} · {ticket?.subject}
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
					<div>
						<Label className="text-xs">Visibility</Label>
						<Select
							value={visibility}
							onValueChange={(v) => setVisibility(v as "Internal" | "Guest Safe")}
						>
							<SelectTrigger data-testid="note-visibility"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="Internal">Internal (staff only)</SelectItem>
								<SelectItem value="Guest Safe">Guest Safe (visible to front desk)</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div>
						<Label className="text-xs">Note</Label>
						<Textarea
							value={note}
							onChange={(e) => setNote(e.target.value)}
							placeholder="Add observation, parts status, or guest-facing update…"
							rows={5}
							data-testid="note-text"
						/>
					</div>
				</div>

				<SheetFooter className="border-t px-4 py-3">
					<Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button onClick={submit} disabled={busy} data-testid="note-submit">
						{busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
						Save note
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
