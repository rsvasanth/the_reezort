/**
 * Leaves tab — self pane (my leaves + balances) + manager pane (pending inbox).
 * Backed by staff.leave_api (spec 008, ui-ux-leave-queue).
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
	FolioApiError,
	cancelLeaveRequest,
	createLeaveRequest,
	decideLeave,
	listMyLeaves,
	listPendingLeaves,
	type LeaveRow,
	type MyLeaves,
	type PendingLeaveRow,
} from "@/lib/staff-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function statusBadge(status: LeaveRow["status"]) {
	if (status === "Approved") return <Badge variant="secondary">Approved</Badge>;
	if (status === "Rejected") return <Badge variant="destructive">Rejected</Badge>;
	if (status === "Cancelled") return <Badge variant="outline">Cancelled</Badge>;
	return <Badge variant="outline" className="border-warning text-warning">Pending</Badge>;
}

export default function LeavesTab() {
	const [my, setMy] = useState<MyLeaves | null>(null);
	const [pending, setPending] = useState<PendingLeaveRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [openRequest, setOpenRequest] = useState(false);

	const reload = useCallback(async () => {
		try {
			const mine = await listMyLeaves();
			setMy(mine);
			if (mine.is_manager) {
				const box = await listPendingLeaves();
				setPending(box.leaves);
			}
		} catch (error) {
			reportError(error, "Could not load leaves");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { reload(); }, [reload]);

	async function onCancel(name: string) {
		try {
			await cancelLeaveRequest(name);
			toast.success("Request cancelled");
			await reload();
		} catch (error) {
			reportError(error, "Cancel failed");
		}
	}

	async function onDecide(name: string, action: "Approve" | "Reject") {
		const notes = window.prompt(`${action} — notes (optional):`) ?? undefined;
		try {
			await decideLeave(name, action, notes || undefined);
			toast.success(action === "Approve" ? "Approved" : "Rejected");
			await reload();
		} catch (error) {
			reportError(error, `${action} failed`);
		}
	}

	if (loading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading leaves…
			</div>
		);
	}

	if (!my?.employee) {
		return (
			<Card><CardContent className="py-8 text-sm text-muted-foreground">
				Your login is not linked to an Employee record. Ask a manager to link it.
			</CardContent></Card>
		);
	}

	return (
		<div className="flex flex-col gap-6" data-testid="leaves-tab">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-medium">Leaves</h2>
				<Button size="sm" onClick={() => setOpenRequest(true)} data-testid="request-leave-btn">
					<Plus className="size-4" /> Request leave
				</Button>
			</div>

			<div className="grid gap-3 md:grid-cols-3">
				{my.balances.map((b) => (
					<Card key={b.leave_type}>
						<CardContent className="py-4">
							<div className="text-xs text-muted-foreground">{b.leave_type}</div>
							<div className="mt-1 text-2xl font-light">
								{b.remaining_days} <span className="text-sm text-muted-foreground">/ {b.max_days}</span>
							</div>
							<div className="text-xs text-muted-foreground">remaining</div>
						</CardContent>
					</Card>
				))}
			</div>

			<div>
				<h3 className="mb-2 text-sm font-medium">My leaves</h3>
				{my.leaves.length === 0 ? (
					<Card><CardContent className="py-6 text-sm text-muted-foreground">
						No leave requests yet. Tap Request to file one.
					</CardContent></Card>
				) : (
					<div className="rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Type</TableHead>
									<TableHead>From</TableHead>
									<TableHead>To</TableHead>
									<TableHead>Days</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{my.leaves.map((l) => (
									<TableRow key={l.name} data-testid={`my-leave-${l.name}`}>
										<TableCell>{l.leave_type}</TableCell>
										<TableCell>{l.from_date ?? "—"}</TableCell>
										<TableCell>{l.to_date ?? "—"}</TableCell>
										<TableCell>{l.total_leave_days}</TableCell>
										<TableCell>{statusBadge(l.status)}</TableCell>
										<TableCell className="text-right">
											{l.status === "Open" && l.docstatus === 0 ? (
												<Button
													variant="ghost"
													size="icon"
													aria-label="Cancel request"
													onClick={() => onCancel(l.name)}
													data-testid={`cancel-leave-${l.name}`}
												>
													<X className="size-4" />
												</Button>
											) : null}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</div>

			{my.is_manager ? (
				<div>
					<h3 className="mb-2 text-sm font-medium">Pending decisions</h3>
					{pending.length === 0 ? (
						<Card><CardContent className="py-6 text-sm text-muted-foreground">
							<Check className="mr-1 inline size-4" /> No pending leave requests.
						</CardContent></Card>
					) : (
						<div className="rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Employee</TableHead>
										<TableHead>Type</TableHead>
										<TableHead>From</TableHead>
										<TableHead>Days</TableHead>
										<TableHead>Reason</TableHead>
										<TableHead className="text-right">Decide</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{pending.map((r) => (
										<TableRow key={r.name} data-testid={`pending-leave-${r.name}`}>
											<TableCell>{r.employee_name}</TableCell>
											<TableCell>{r.leave_type}</TableCell>
											<TableCell>{r.from_date ?? "—"}</TableCell>
											<TableCell>{r.total_leave_days}</TableCell>
											<TableCell className="max-w-[24ch] truncate text-xs text-muted-foreground">
												{r.description ?? "—"}
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="icon"
														aria-label={`Approve leave for ${r.employee_name}`}
														onClick={() => onDecide(r.name, "Approve")}
														data-testid={`approve-leave-${r.name}`}
													>
														<Check className="size-4 text-success" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														aria-label={`Reject leave for ${r.employee_name}`}
														onClick={() => onDecide(r.name, "Reject")}
														data-testid={`reject-leave-${r.name}`}
													>
														<X className="size-4 text-danger" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</div>
			) : null}

			<RequestLeaveSheet
				open={openRequest}
				onOpenChange={setOpenRequest}
				balances={my.balances.map((b) => b.leave_type)}
				onSubmitted={async () => {
					setOpenRequest(false);
					await reload();
				}}
			/>
		</div>
	);
}

function RequestLeaveSheet({
	open,
	onOpenChange,
	balances,
	onSubmitted,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	balances: string[];
	onSubmitted: () => Promise<void>;
}) {
	const [type, setType] = useState<string>(balances[0] ?? "");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) {
			setType(balances[0] ?? "");
			setFrom("");
			setTo("");
			setReason("");
		}
	}, [open, balances]);

	async function submit() {
		if (!type || !from || !to) {
			toast.error("Fill type, from and to");
			return;
		}
		setBusy(true);
		try {
			await createLeaveRequest({ leave_type: type, from_date: from, to_date: to, reason });
			toast.success("Leave request submitted");
			await onSubmitted();
		} catch (error) {
			reportError(error, "Request failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full sm:max-w-md">
				<SheetHeader>
					<SheetTitle>Request leave</SheetTitle>
					<SheetDescription>Manager approval required.</SheetDescription>
				</SheetHeader>
				<div className="mt-6 flex flex-col gap-4">
					<div>
						<Label>Type</Label>
						<Select value={type} onValueChange={setType}>
							<SelectTrigger data-testid="req-leave-type">
								<SelectValue placeholder="Choose type" />
							</SelectTrigger>
							<SelectContent>
								{balances.map((b) => (
									<SelectItem key={b} value={b}>{b}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div>
							<Label>From</Label>
							<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="req-leave-from" />
						</div>
						<div>
							<Label>To</Label>
							<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="req-leave-to" />
						</div>
					</div>
					<div>
						<Label>Reason (visible to your manager)</Label>
						<Input
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="Reason (optional)"
							data-testid="req-leave-reason"
						/>
					</div>
				</div>
				<SheetFooter className="mt-6">
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
					<Button onClick={submit} disabled={busy} data-testid="req-leave-submit">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
