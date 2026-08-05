/**
 * Approvals Inbox — tabs: Pending for me · All open (manager) · My requests.
 * Approve/Reject via a small notes popover; self-approval blocked server-side.
 * (spec 015-security-audit-compliance / ui-ux-approvals-inbox.md)
 */

import { useCallback, useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace";
import { AnimatePresence, motion } from "motion/react";
import { Check, ExternalLink, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
	decideApprovalRequest,
	listAllOpenApprovals,
	listMyApprovalRequests,
	listPendingForMe,
	type ApprovalRequest,
} from "@/lib/approvals-api";
import { FolioApiError } from "@/lib/folio-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function formatDT(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", {
		day: "2-digit", month: "short", year: "numeric",
		hour: "2-digit", minute: "2-digit",
	}).format(d);
}

function formatINR(n: number | null | undefined): string {
	if (n === null || n === undefined) return "—";
	return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function stateBadge(state?: string) {
	const s = state ?? "Pending";
	if (s === "Approved") return <Badge variant="secondary">Approved</Badge>;
	if (s === "Auto-Approved") return <Badge variant="outline" className="border-success text-success">Auto</Badge>;
	if (s === "Rejected") return <Badge variant="destructive">Rejected</Badge>;
	if (s === "Cancelled") return <Badge variant="outline">Cancelled</Badge>;
	return <Badge variant="outline" className="border-warning text-warning">Pending</Badge>;
}

function deskUrl(doctype: string | null, name: string | null): string | null {
	if (!doctype || !name) return null;
	return `/app/${doctype.toLowerCase().replace(/\s+/g, "-")}/${encodeURIComponent(name)}`;
}

export default function ApprovalsInboxScreen() {
	const [pending, setPending] = useState<ApprovalRequest[]>([]);
	const [allOpen, setAllOpen] = useState<ApprovalRequest[]>([]);
	const [mine, setMine] = useState<ApprovalRequest[]>([]);
	const [loading, setLoading] = useState(true);
	const [showAll, setShowAll] = useState(true);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const [p, m] = await Promise.all([
				listPendingForMe().catch(() => ({ requests: [] })),
				listMyApprovalRequests().catch(() => ({ requests: [] })),
			]);
			setPending(p.requests);
			setMine(m.requests);
			try {
				const a = await listAllOpenApprovals();
				setAllOpen(a.requests);
				setShowAll(true);
			} catch {
				setShowAll(false);
			}
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { reload(); }, [reload]);

	return (
		<WorkspacePage title="Approvals" subtitle="Requests waiting on your decision." testId="approvals-inbox">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<Badge variant="outline" className="mb-2 gap-1">
						<ShieldCheck className="size-3" /> Compliance
					</Badge>
					<h1 className="text-3xl font-light text-foreground md:text-4xl">Approvals inbox</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Requests routed to your role, plus everything you've filed yourself.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Badge variant="outline">Pending for me · {pending.length}</Badge>
					{showAll ? <Badge variant="outline">All open · {allOpen.length}</Badge> : null}
					<Badge variant="outline">My requests · {mine.length}</Badge>
				</div>
			</header>

			<Tabs defaultValue="pending">
				<TabsList data-testid="inbox-tabs">
					<TabsTrigger value="pending">Pending for me</TabsTrigger>
					{showAll ? <TabsTrigger value="all">All open</TabsTrigger> : null}
					<TabsTrigger value="mine">My requests</TabsTrigger>
				</TabsList>

				<TabsContent value="pending" className="mt-4">
					<RequestList
						items={pending}
						loading={loading}
						emptyLabel="Nothing pending — your role has no open approvals."
						showDecide
						onDecided={reload}
					/>
				</TabsContent>

				{showAll ? (
					<TabsContent value="all" className="mt-4">
						<RequestList
							items={allOpen}
							loading={loading}
							emptyLabel="No open requests across the site."
							showDecide={false}
							onDecided={reload}
						/>
					</TabsContent>
				) : null}

				<TabsContent value="mine" className="mt-4">
					<RequestList
						items={mine}
						loading={loading}
						emptyLabel="You haven't filed any approval requests."
						showDecide={false}
						onDecided={reload}
					/>
				</TabsContent>
			</Tabs>
		</WorkspacePage>
	);
}

function RequestList({
	items,
	loading,
	emptyLabel,
	showDecide,
	onDecided,
}: {
	items: ApprovalRequest[];
	loading: boolean;
	emptyLabel: string;
	showDecide: boolean;
	onDecided: () => Promise<void>;
}) {
	if (loading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading…
			</div>
		);
	}
	if (items.length === 0) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</CardContent>
			</Card>
		);
	}
	return (
		<motion.div className="flex flex-col gap-2" variants={staggerContainer} initial="hidden" animate="show">
			{items.map((r) => (
				<motion.div key={r.name} variants={staggerItem}>
					<RequestRow request={r} showDecide={showDecide} onDecided={onDecided} />
				</motion.div>
			))}
		</motion.div>
	);
}

function RequestRow({
	request,
	showDecide,
	onDecided,
}: {
	request: ApprovalRequest;
	showDecide: boolean;
	onDecided: () => Promise<void>;
}) {
	const [busy, setBusy] = useState<null | "Approved" | "Rejected">(null);
	const [notes, setNotes] = useState("");
	const [showNotes, setShowNotes] = useState(false);
	const desk = deskUrl(request.source_doctype, request.source_name);

	async function decide(decision: "Approved" | "Rejected") {
		setBusy(decision);
		try {
			await decideApprovalRequest(request.name, decision, notes);
			toast.success(decision === "Approved" ? "Approved" : "Rejected");
			setShowNotes(false);
			setNotes("");
			await onDecided();
		} catch (error) {
			reportError(error, `${decision} failed`);
		} finally {
			setBusy(null);
		}
	}

	return (
		<Card>
			<CardContent className="flex flex-col gap-2 py-4">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-medium">{request.action}</span>
							<span className="text-xs text-muted-foreground">
								{request.source_doctype} {request.source_name}
							</span>
							{stateBadge(request.state)}
							{request.approver_role ? (
								<Badge variant="outline" className="text-[10px]">Role: {request.approver_role}</Badge>
							) : null}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
							<span>By {request.requester_name || request.requester}</span>
							<span>· {formatDT(request.requested_at)}</span>
							{request.amount !== null && request.amount !== undefined ? (
								<span>· {formatINR(request.amount)}</span>
							) : null}
							{request.decided_at ? <span>· Decided {formatDT(request.decided_at)}</span> : null}
						</div>
						{request.reason ? (
							<div className="mt-1 text-xs text-muted-foreground">Reason: {request.reason}</div>
						) : null}
						{request.decision_notes ? (
							<div className="mt-1 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
								<span className="font-medium">Notes:</span> {request.decision_notes}
							</div>
						) : null}
					</div>
					<div className="flex flex-col items-end gap-2">
						{desk ? (
							<a
								href={desk}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
								data-testid={`open-${request.name}`}
							>
								Open source <ExternalLink className="size-3" />
							</a>
						) : null}
						{showDecide ? (
							<div className="flex items-center gap-1">
								<Button
									size="sm"
									variant="outline"
									onClick={() => setShowNotes((v) => !v)}
									data-testid={`toggle-notes-${request.name}`}
								>
									Notes
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => decide("Approved")}
									disabled={!!busy}
									data-testid={`approve-${request.name}`}
								>
									{busy === "Approved" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 text-success" />}
									Approve
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => decide("Rejected")}
									disabled={!!busy}
									data-testid={`reject-${request.name}`}
								>
									{busy === "Rejected" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4 text-danger" />}
									Reject
								</Button>
							</div>
						) : null}
					</div>
				</div>

				<AnimatePresence>
					{showNotes ? (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							transition={{ duration: 0.2 }}
							className="overflow-hidden"
						>
							<div className="pt-2">
								<Label className="text-xs">Decision notes (optional)</Label>
								<Input
									value={notes}
									onChange={(e) => setNotes(e.target.value)}
									placeholder="Verified over phone with the guest…"
									className="mt-1"
								/>
							</div>
						</motion.div>
					) : null}
				</AnimatePresence>
			</CardContent>
		</Card>
	);
}
