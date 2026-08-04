/**
 * Direct Billing — create and view non-stay direct bills (walk-in restaurant,
 * spa, event clients). Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, ReceiptText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { WorkspacePage, KpiStrip } from "@/components/workspace/workspace";
import { formatCurrency } from "@/components/folio/folio-format";
import {
	FolioApiError,
	createDirectBill,
	listDirectBills,
	type DirectBillSummary,
	type DirectBillLine,
} from "@/lib/direct-bill-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.message : String(error);
	toast.error(fallback, { description: detail });
}

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "outline" | "default"> = {
	Paid: "secondary",
	Outstanding: "destructive",
	Failed: "destructive",
	Submitted: "outline",
	Posted: "outline",
	Draft: "outline",
	Cancelled: "outline",
};

type LineRow = DirectBillLine & { id: number };

export default function DirectBillScreen() {
	const [bills, setBills] = useState<DirectBillSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);

	const reload = useCallback(async () => {
		try {
			const data = await listDirectBills();
			setBills(data.bills);
		} catch (error) {
			reportError(error, "Could not load direct bills");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	const summary = {
		total: bills.length,
		paid: bills.filter((b) => b.direct_bill_status === "Paid").length,
		outstanding: bills.filter((b) => b.direct_bill_status === "Outstanding").length,
		totalAmount: bills.reduce((sum, b) => sum + b.total_amount, 0),
	};

	return (
		<WorkspacePage
			testId="direct-bill-screen"
			badge="Billing"
			title="Direct billing"
			subtitle="Non-stay billing for walk-in clients, restaurants, spa, and events."
			action={
				<Button onClick={() => setCreating(true)} data-testid="new-direct-bill">
					<Plus className="size-4" /> New direct bill
				</Button>
			}
		>
			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : (
				<>
					<KpiStrip
						items={[
							{ label: "Total bills", value: summary.total },
							{ label: "Paid", value: summary.paid },
							{ label: "Outstanding", value: summary.outstanding, accent: summary.outstanding > 0 ? "danger" : undefined },
							{ label: "Revenue", value: formatCurrency(summary.totalAmount, "INR") },
						]}
					/>

					<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Bill #</TableHead>
									<TableHead>Customer</TableHead>
									<TableHead>Department</TableHead>
									<TableHead>Date</TableHead>
									<TableHead className="text-right">Amount</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Invoice</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{bills.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
											No direct bills yet. Click "New direct bill" to create one.
										</TableCell>
									</TableRow>
								) : (
									bills.map((b) => (
										<TableRow key={b.name} data-testid={`dbill-${b.name}`}>
											<TableCell className="font-medium">{b.name}</TableCell>
											<TableCell className="text-sm">{b.customer_name}</TableCell>
											<TableCell className="text-sm">{b.source_department ?? "—"}</TableCell>
											<TableCell className="text-sm">{b.creation?.slice(0, 10) ?? "—"}</TableCell>
											<TableCell className="text-right">{formatCurrency(b.total_amount, b.currency)}</TableCell>
											<TableCell>
												<Badge variant={STATUS_VARIANT[b.direct_bill_status] ?? "outline"}>
													{b.direct_bill_status}
												</Badge>
											</TableCell>
											<TableCell className="text-sm">{b.sales_invoice ?? "—"}</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</>
			)}

			{creating ? (
				<CreateDirectBillSheet onClose={() => setCreating(false)} onCreated={reload} />
			) : null}
		</WorkspacePage>
	);
}

let nextLineId = 1;

function CreateDirectBillSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
	const [customer, setCustomer] = useState("");
	const [department, setDepartment] = useState("");
	const [paymentMode, setPaymentMode] = useState("Cash");
	const [paymentRef, setPaymentRef] = useState("");
	const [creditAllowed, setCreditAllowed] = useState(false);
	const [lines, setLines] = useState<LineRow[]>([
		{ id: nextLineId++, item_code: "", description: "", qty: 1, rate: 0 },
	]);
	const [busy, setBusy] = useState(false);

	function addLine() {
		setLines((prev) => [...prev, { id: nextLineId++, item_code: "", description: "", qty: 1, rate: 0 }]);
	}

	function removeLine(id: number) {
		setLines((prev) => prev.filter((l) => l.id !== id));
	}

	function updateLine(id: number, patch: Partial<LineRow>) {
		setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	}

	const total = lines.reduce((sum, l) => sum + l.qty * l.rate, 0);

	async function submit() {
		if (!customer.trim()) {
			toast.error("Customer is required");
			return;
		}
		const validLines = lines.filter((l) => l.item_code.trim() && l.rate > 0);
		if (validLines.length === 0) {
			toast.error("Add at least one line with an item and rate");
			return;
		}

		setBusy(true);
		try {
			const result = await createDirectBill({
				resort_property: "",
				customer: customer.trim(),
				source_department: department.trim() || undefined,
				idempotency_key: `dbill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				lines: validLines.map((l) => ({
					item_code: l.item_code.trim(),
					description: l.description || l.item_code.trim(),
					qty: l.qty,
					rate: l.rate,
				})),
				payment: creditAllowed
					? undefined
					: {
							mode_of_payment: paymentMode.trim() || "Cash",
							amount: total,
							reference_no: paymentRef.trim() || undefined,
						},
				credit_allowed: creditAllowed,
			});
			toast.success("Direct bill created", {
				description: `${result.direct_bill} — ${result.posting_status}`,
			});
			onCreated();
			onClose();
		} catch (error) {
			reportError(error, "Could not create direct bill");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg" data-testid="create-dbill-sheet">
				<SheetHeader>
					<SheetTitle>New direct bill</SheetTitle>
					<SheetDescription>Bill a walk-in or non-stay client directly.</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-4 px-4 py-4">
					{/* Customer */}
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">Customer (ERPNext Customer ID)</Label>
						<Input
							value={customer}
							onChange={(e) => setCustomer(e.target.value)}
							placeholder="e.g. CUST-00001 or customer name"
							data-testid="dbill-customer"
						/>
					</div>

					{/* Department */}
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">Source department</Label>
						<Input
							value={department}
							onChange={(e) => setDepartment(e.target.value)}
							placeholder="e.g. Restaurant, Spa"
						/>
					</div>

					{/* Lines */}
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between">
							<Label className="text-sm font-semibold">Line items</Label>
							<Button size="sm" variant="ghost" onClick={addLine}>
								<Plus className="size-3" /> Add line
							</Button>
						</div>

						{lines.map((line) => (
							<div key={line.id} className="flex items-end gap-2 rounded-md border p-2">
								<div className="flex flex-1 flex-col gap-1">
									<Input
										value={line.item_code}
										onChange={(e) => updateLine(line.id, { item_code: e.target.value })}
										placeholder="Item code"
										className="h-8 text-sm"
									/>
									<Input
										value={line.description ?? ""}
										onChange={(e) => updateLine(line.id, { description: e.target.value })}
										placeholder="Description"
										className="h-8 text-sm"
									/>
								</div>
								<div className="flex flex-col gap-1">
									<Input
										type="number"
										value={line.qty}
										onChange={(e) => updateLine(line.id, { qty: Number(e.target.value) || 1 })}
										className="h-8 w-16 text-sm"
										min={1}
									/>
								</div>
								<div className="flex flex-col gap-1">
									<Input
										type="number"
										value={line.rate}
										onChange={(e) => updateLine(line.id, { rate: Number(e.target.value) || 0 })}
										className="h-8 w-24 text-sm"
										min={0}
										step={0.01}
									/>
								</div>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => removeLine(line.id)}
									disabled={lines.length <= 1}
									className="h-8"
								>
									<Trash2 className="size-3" />
								</Button>
							</div>
						))}

						<div className="text-right text-sm font-semibold">
							Total: {formatCurrency(total, "INR")}
						</div>
					</div>

					{/* Payment */}
					<div className="flex flex-col gap-2">
						<Label className="text-sm font-semibold">Payment</Label>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={creditAllowed}
								onChange={(e) => setCreditAllowed(e.target.checked)}
							/>
							Credit allowed (no immediate payment)
						</label>
						{!creditAllowed ? (
							<div className="flex gap-2">
								<div className="flex flex-1 flex-col gap-1">
									<Label className="text-xs">Mode of payment</Label>
									<Input
										value={paymentMode}
										onChange={(e) => setPaymentMode(e.target.value)}
										placeholder="Cash"
										className="h-8 text-sm"
									/>
								</div>
								<div className="flex flex-1 flex-col gap-1">
									<Label className="text-xs">Reference</Label>
									<Input
										value={paymentRef}
										onChange={(e) => setPaymentRef(e.target.value)}
										placeholder="Txn / receipt #"
										className="h-8 text-sm"
									/>
								</div>
							</div>
						) : null}
					</div>
				</div>

				<SheetFooter>
					<Button onClick={submit} disabled={busy} data-testid="dbill-submit">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <ReceiptText className="size-4" />} Create & post
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
