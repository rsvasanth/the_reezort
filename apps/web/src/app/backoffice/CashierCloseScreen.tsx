/**
 * Cashier Close — shift reconciliation (spec 008). Open a shift, declare counted
 * cash per payment mode, see the variance vs. system-collected totals, and close.
 * Over-threshold variances need a reason and a manager decision. Mount in <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/components/folio/folio-format";
import {
	approveCashierClose,
	CashierApiError,
	getCashierClose,
	getCashierContext,
	listCashierCloses,
	openCashierClose,
	submitCashierClose,
	type CashierClose,
	type CashierCloseSummary,
	type CashierContext,
} from "@/lib/cashier-api";
import { listOutlets, type FnbOutlet } from "@/lib/fnb-api";

const CLOSE_TYPES = ["Front Desk", "F&B", "Event", "Night Audit", "Other"];

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
	Approved: "secondary",
	Rejected: "destructive",
	Submitted: "outline",
	Open: "outline",
};

function fmt(n: number) {
	return formatCurrency(n, "INR");
}

export default function CashierCloseScreen() {
	const [recent, setRecent] = useState<CashierCloseSummary[]>([]);
	const [active, setActive] = useState<CashierClose | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	// Open-shift form
	const [closeType, setCloseType] = useState("Front Desk");
	const [cashFloat, setCashFloat] = useState("2000");
	const [outlet, setOutlet] = useState<string>("");
	const [outlets, setOutlets] = useState<FnbOutlet[]>([]);
	const [context, setContext] = useState<CashierContext | null>(null);

	// Declaration inputs, keyed by payment mode
	const [declared, setDeclared] = useState<Record<string, string>>({});
	const [reason, setReason] = useState("");
	const [approvalNote, setApprovalNote] = useState("");

	const refreshList = useCallback(async () => {
		try {
			const res = await listCashierCloses();
			setRecent(res.closes);
		} catch (e) {
			toast.error(e instanceof CashierApiError ? e.message : "Could not load cashier closes");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshList();
	}, [refreshList]);

	// Load outlets the first time F&B is chosen so a shift can be scoped to one.
	useEffect(() => {
		if (closeType !== "F&B" || outlets.length) return;
		listOutlets().then((r) => setOutlets(r.outlets)).catch(() => setOutlets([]));
	}, [closeType, outlets.length]);

	// Preview the outlet's expected takings before opening the shift.
	useEffect(() => {
		let alive = true;
		const scopedOutlet = closeType === "F&B" ? outlet || undefined : undefined;
		getCashierContext(closeType, scopedOutlet)
			.then((ctx) => alive && setContext(ctx))
			.catch(() => alive && setContext(null));
		return () => {
			alive = false;
		};
	}, [closeType, outlet]);

	async function openShift() {
		if (closeType === "F&B" && !outlet) {
			toast.error("Pick an outlet for an F&B shift.");
			return;
		}
		setBusy(true);
		try {
			const close = await openCashierClose({
				close_type: closeType,
				cash_float: Number(cashFloat) || 0,
				outlet: closeType === "F&B" ? outlet : undefined,
			});
			setActive(close);
			setDeclared({});
			setReason("");
			toast.success(`Shift ${close.name} opened`);
			await refreshList();
		} catch (e) {
			toast.error(e instanceof CashierApiError ? e.message : "Could not open shift");
		} finally {
			setBusy(false);
		}
	}

	async function loadClose(name: string) {
		setBusy(true);
		try {
			const close = await getCashierClose(name);
			setActive(close);
			setDeclared(
				Object.fromEntries(close.payments.map((p) => [p.payment_mode, String(p.declared_amount || "")]))
			);
			setReason(close.variance_reason ?? "");
		} catch (e) {
			toast.error(e instanceof CashierApiError ? e.message : "Could not load close");
		} finally {
			setBusy(false);
		}
	}

	// Live variance preview from the declared inputs against the loaded expecteds.
	const previewRows = (active?.payments ?? []).map((p) => {
		const dec = Number(declared[p.payment_mode] ?? p.declared_amount ?? 0) || 0;
		return { mode: p.payment_mode, expected: p.expected_amount, declared: dec, variance: dec - p.expected_amount };
	});
	const previewVariance = previewRows.reduce((s, r) => s + r.variance, 0);
	const overThreshold = active ? Math.abs(previewVariance) > active.variance_threshold : false;

	async function submitClose() {
		if (!active) return;
		if (Math.abs(previewVariance) > 0.009 && !reason.trim()) {
			toast.error("A variance needs a reason before you can close.");
			return;
		}
		setBusy(true);
		try {
			const close = await submitCashierClose(active.name, {
				payments: previewRows.map((r) => ({ payment_mode: r.mode, declared_amount: r.declared })),
				variance_reason: reason.trim() || undefined,
			});
			setActive(close);
			if (close.close_status === "Submitted") {
				toast.warning("Variance over threshold — sent for manager approval.");
			} else {
				toast.success(`Shift closed · ${close.close_status}`);
			}
			await refreshList();
		} catch (e) {
			toast.error(e instanceof CashierApiError ? e.message : "Could not close shift");
		} finally {
			setBusy(false);
		}
	}

	async function decide(decision: "Approve" | "Reject") {
		if (!active) return;
		setBusy(true);
		try {
			const close = await approveCashierClose(active.name, decision, approvalNote.trim());
			setActive(close);
			setApprovalNote("");
			toast.success(`Close ${decision === "Approve" ? "approved" : "rejected"}`);
			await refreshList();
		} catch (e) {
			toast.error(e instanceof CashierApiError ? e.message : "Could not decide close");
		} finally {
			setBusy(false);
		}
	}

	const editable = active && ["Open", "Closing", "Reopened"].includes(active.close_status);

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Cashier Close</h1>
				<p className="text-muted-foreground text-sm">
					Reconcile counted cash against system-collected payments and close the shift.
				</p>
			</div>

			{/* Open shift */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Open a shift</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-wrap items-end gap-4">
					<div className="flex flex-col gap-1">
						<Label>Close type</Label>
						<Select value={closeType} onValueChange={setCloseType}>
							<SelectTrigger className="w-44">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{CLOSE_TYPES.map((t) => (
									<SelectItem key={t} value={t}>
										{t}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{closeType === "F&B" ? (
						<div className="flex flex-col gap-1">
							<Label>Outlet</Label>
							<Select value={outlet} onValueChange={setOutlet}>
								<SelectTrigger className="w-52">
									<SelectValue placeholder="Choose outlet…" />
								</SelectTrigger>
								<SelectContent>
									{outlets.map((o) => (
										<SelectItem key={o.name} value={o.name}>
											{o.outlet_name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : null}
					<div className="flex flex-col gap-1">
						<Label>Cash float</Label>
						<Input
							className="w-32"
							type="number"
							value={cashFloat}
							onChange={(e) => setCashFloat(e.target.value)}
						/>
					</div>
					<Button onClick={openShift} disabled={busy}>
						{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
						Open shift
					</Button>

					{/* Live preview of what this shift will reconcile. */}
					{context ? (
						<div className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3 text-sm">
							<span className="text-muted-foreground">
								Expected collected:{" "}
								<span className="font-medium text-foreground">{fmt(context.expected_total)}</span>
							</span>
							{context.fnb_summary ? (
								<>
									<span className="text-muted-foreground">
										Orders settled:{" "}
										<span className="font-medium text-foreground">{context.fnb_summary.orders_settled}</span>
									</span>
									<span className="text-muted-foreground">
										POS cash:{" "}
										<span className="font-medium text-foreground">{fmt(context.fnb_summary.pos_cash_total)}</span>
									</span>
									<span className="text-muted-foreground">
										Charged to rooms:{" "}
										<span className="font-medium text-foreground">{fmt(context.fnb_summary.room_charged_total)}</span>
									</span>
								</>
							) : null}
						</div>
					) : null}
				</CardContent>
			</Card>

			{/* Active close reconciliation */}
			{active ? (
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="text-base">
							{active.name} · {active.close_type}
						</CardTitle>
						<Badge variant={STATUS_VARIANT[active.close_status] ?? "outline"}>{active.close_status}</Badge>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Payment mode</TableHead>
									<TableHead className="text-right">Expected</TableHead>
									<TableHead className="text-right">Declared</TableHead>
									<TableHead className="text-right">Variance</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{previewRows.map((r) => (
									<TableRow key={r.mode}>
										<TableCell className="font-medium">{r.mode}</TableCell>
										<TableCell className="text-right tabular-nums">{fmt(r.expected)}</TableCell>
										<TableCell className="text-right">
											{editable ? (
												<Input
													className="ml-auto w-28 text-right"
													type="number"
													value={declared[r.mode] ?? ""}
													onChange={(e) =>
														setDeclared((d) => ({ ...d, [r.mode]: e.target.value }))
													}
												/>
											) : (
												<span className="tabular-nums">{fmt(r.declared)}</span>
											)}
										</TableCell>
										<TableCell
											className={`text-right tabular-nums ${
												Math.abs(r.variance) > 0.009 ? "text-destructive" : "text-muted-foreground"
											}`}
										>
											{fmt(r.variance)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>

						<div className="flex items-center justify-between rounded-md border p-3 text-sm">
							<span className="text-muted-foreground">Total variance</span>
							<span
								className={`text-lg font-semibold tabular-nums ${
									Math.abs(previewVariance) > 0.009 ? "text-destructive" : ""
								}`}
							>
								{fmt(previewVariance)}
							</span>
						</div>

						{editable ? (
							<>
								{Math.abs(previewVariance) > 0.009 ? (
									<div className="flex flex-col gap-1">
										<Label>
											Variance reason{" "}
											{overThreshold ? (
												<span className="text-destructive">(over threshold — needs approval)</span>
											) : null}
										</Label>
										<Textarea
											value={reason}
											onChange={(e) => setReason(e.target.value)}
											placeholder="Explain the difference…"
										/>
									</div>
								) : null}
								<div>
									<Button onClick={submitClose} disabled={busy}>
										{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
										Close shift
									</Button>
								</div>
							</>
						) : null}

						{active.close_status === "Submitted" ? (
							<div className="flex flex-col gap-2 rounded-md border border-warning bg-warning p-3">
								<p className="text-sm font-medium text-warning">
									Variance {fmt(active.variance_amount)} is awaiting manager approval.
								</p>
								<Textarea
									value={approvalNote}
									onChange={(e) => setApprovalNote(e.target.value)}
									placeholder="Approval note…"
								/>
								<div className="flex gap-2">
									<Button size="sm" onClick={() => decide("Approve")} disabled={busy}>
										Approve
									</Button>
									<Button size="sm" variant="destructive" onClick={() => decide("Reject")} disabled={busy}>
										Reject
									</Button>
								</div>
							</div>
						) : null}
					</CardContent>
				</Card>
			) : null}

			{/* Recent closes */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Recent closes</CardTitle>
				</CardHeader>
				<CardContent>
					{loading ? (
						<div className="text-muted-foreground flex items-center gap-2 text-sm">
							<Loader2 className="h-4 w-4 animate-spin" /> Loading…
						</div>
					) : recent.length === 0 ? (
						<p className="text-muted-foreground text-sm">No cashier closes yet.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Close</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Cashier</TableHead>
									<TableHead className="text-right">Expected</TableHead>
									<TableHead className="text-right">Variance</TableHead>
									<TableHead>Status</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{recent.map((c) => (
									<TableRow key={c.name}>
										<TableCell className="font-medium">{c.name}</TableCell>
										<TableCell>{c.close_type}</TableCell>
										<TableCell className="text-muted-foreground">{c.cashier_user}</TableCell>
										<TableCell className="text-right tabular-nums">{fmt(c.expected_total)}</TableCell>
										<TableCell className="text-right tabular-nums">{fmt(c.variance_amount)}</TableCell>
										<TableCell>
											<Badge variant={STATUS_VARIANT[c.close_status] ?? "outline"}>
												{c.close_status}
											</Badge>
										</TableCell>
										<TableCell className="text-right">
											<Button size="sm" variant="ghost" onClick={() => loadClose(c.name)}>
												Open
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
