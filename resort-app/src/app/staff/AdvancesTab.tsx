/**
 * Advances tab — self pane + manager pane for Employee Advance.
 * Backed by staff.advance_api (spec 008, ui-ux-advance-queue).
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
	cancelAdvanceRequest,
	createAdvanceRequest,
	decideAdvance,
	listMyAdvances,
	listPendingAdvances,
	type AdvanceRow,
	type MyAdvances,
	type PendingAdvanceRow,
} from "@/lib/staff-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function statusBadge(status: AdvanceRow["status"], docstatus: number) {
	if (status === "Paid") return <Badge variant="secondary">Paid</Badge>;
	if (status === "Unpaid") return <Badge variant="outline" className="border-blue-500 text-blue-700">Approved · Unpaid</Badge>;
	if (status === "Cancelled") return <Badge variant="outline">Cancelled</Badge>;
	if (docstatus === 0) return <Badge variant="outline" className="border-amber-500 text-amber-700">Pending</Badge>;
	return <Badge variant="outline">{status}</Badge>;
}

export default function AdvancesTab() {
	const [my, setMy] = useState<MyAdvances | null>(null);
	const [pending, setPending] = useState<PendingAdvanceRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [openRequest, setOpenRequest] = useState(false);

	const reload = useCallback(async () => {
		try {
			const mine = await listMyAdvances();
			setMy(mine);
			if (mine.is_manager) {
				const box = await listPendingAdvances();
				setPending(box.advances);
			}
		} catch (error) {
			reportError(error, "Could not load advances");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { reload(); }, [reload]);

	async function onCancel(name: string) {
		try {
			await cancelAdvanceRequest(name);
			toast.success("Request cancelled");
			await reload();
		} catch (error) {
			reportError(error, "Cancel failed");
		}
	}

	async function onDecide(name: string, action: "Approve" | "Reject") {
		const notes = window.prompt(`${action} — notes (optional):`) ?? undefined;
		try {
			await decideAdvance(name, action, notes || undefined);
			toast.success(action === "Approve" ? "Approved" : "Rejected");
			await reload();
		} catch (error) {
			reportError(error, `${action} failed`);
		}
	}

	if (loading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading advances…
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
		<div className="flex flex-col gap-6" data-testid="advances-tab">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-lg font-medium">Advances</h2>
					<div className="text-xs text-muted-foreground">
						Outstanding: <span className="font-medium text-foreground">{formatINR(my.outstanding)}</span> · cap {formatINR(my.cap)}
					</div>
				</div>
				<Button size="sm" onClick={() => setOpenRequest(true)} data-testid="request-advance-btn">
					<Plus className="size-4" /> Request advance
				</Button>
			</div>

			<div>
				<h3 className="mb-2 text-sm font-medium">My advance requests</h3>
				{my.advances.length === 0 ? (
					<Card><CardContent className="py-6 text-sm text-muted-foreground">
						No advance requests yet.
					</CardContent></Card>
				) : (
					<div className="rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Requested</TableHead>
									<TableHead>Amount</TableHead>
									<TableHead>Purpose</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{my.advances.map((a) => (
									<TableRow key={a.name} data-testid={`my-advance-${a.name}`}>
										<TableCell>{a.posting_date ?? "—"}</TableCell>
										<TableCell>{formatINR(a.advance_amount)}</TableCell>
										<TableCell className="max-w-[24ch] truncate">{a.purpose}</TableCell>
										<TableCell>{statusBadge(a.status, a.docstatus)}</TableCell>
										<TableCell className="text-right">
											{a.docstatus === 0 && a.status === "Draft" ? (
												<Button
													variant="ghost"
													size="icon"
													aria-label="Cancel request"
													onClick={() => onCancel(a.name)}
													data-testid={`cancel-advance-${a.name}`}
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
							<Check className="mr-1 inline size-4" /> No pending advance requests.
						</CardContent></Card>
					) : (
						<div className="rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Employee</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Purpose</TableHead>
										<TableHead>Requested</TableHead>
										<TableHead className="text-right">Decide</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{pending.map((r) => (
										<TableRow key={r.name} data-testid={`pending-advance-${r.name}`}>
											<TableCell>{r.employee_name}</TableCell>
											<TableCell>{formatINR(r.advance_amount)}</TableCell>
											<TableCell className="max-w-[24ch] truncate">{r.purpose}</TableCell>
											<TableCell>{r.posting_date ?? "—"}</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="icon"
														aria-label={`Approve advance for ${r.employee_name}`}
														onClick={() => onDecide(r.name, "Approve")}
														data-testid={`approve-advance-${r.name}`}
													>
														<Check className="size-4 text-green-600" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														aria-label={`Reject advance for ${r.employee_name}`}
														onClick={() => onDecide(r.name, "Reject")}
														data-testid={`reject-advance-${r.name}`}
													>
														<X className="size-4 text-red-600" />
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

			<RequestAdvanceSheet
				open={openRequest}
				onOpenChange={setOpenRequest}
				cap={my.cap}
				onSubmitted={async () => {
					setOpenRequest(false);
					await reload();
				}}
			/>
		</div>
	);
}

function RequestAdvanceSheet({
	open,
	onOpenChange,
	cap,
	onSubmitted,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	cap: number;
	onSubmitted: () => Promise<void>;
}) {
	const [amount, setAmount] = useState("");
	const [purpose, setPurpose] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) {
			setAmount("");
			setPurpose("");
		}
	}, [open]);

	async function submit() {
		const n = Number(amount);
		if (!n || n <= 0) {
			toast.error("Enter a valid amount");
			return;
		}
		if (n > cap) {
			toast.error(`Advance capped at ${cap}`);
			return;
		}
		if (!purpose.trim()) {
			toast.error("Purpose is required");
			return;
		}
		setBusy(true);
		try {
			await createAdvanceRequest({ amount: n, purpose });
			toast.success("Advance request submitted");
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
					<SheetTitle>Request advance</SheetTitle>
					<SheetDescription>Cap: {formatINR(cap)}. Manager + Accounts approval required.</SheetDescription>
				</SheetHeader>
				<div className="mt-6 flex flex-col gap-4">
					<div>
						<Label>Amount (INR)</Label>
						<Input
							type="number"
							inputMode="decimal"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
							min="0"
							data-testid="req-advance-amount"
						/>
					</div>
					<div>
						<Label>Purpose (visible to your manager)</Label>
						<Input
							value={purpose}
							onChange={(e) => setPurpose(e.target.value)}
							placeholder="e.g. Medical"
							data-testid="req-advance-purpose"
						/>
					</div>
				</div>
				<SheetFooter className="mt-6">
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
					<Button onClick={submit} disabled={busy} data-testid="req-advance-submit">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
