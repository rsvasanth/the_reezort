import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
	FolioApiError,
	makeSettlementIdempotencyKey,
	settleFolio,
} from "@/lib/folio-api";
import type {
	FolioMessage,
	SettlementPaymentInput,
	SettlementPaymentKind,
} from "@/lib/folio-api";

import { formatCurrency } from "./folio-format";

type Props = {
	open: boolean;
	folioName: string;
	currency: string;
	outstandingAmount: number;
	onClose: () => void;
	onSettled: () => void;
};

const PAYMENT_KINDS: SettlementPaymentKind[] = [
	"Cash",
	"Card",
	"UPI",
	"Bank Transfer",
	"Gateway",
	"Deposit Application",
	"Corporate Credit",
];

type LocalRow = {
	id: string;
	payment_kind: SettlementPaymentKind;
	amount: string;
	payment_mode: string;
	reference_no: string;
};

export function SettleFolioSheet({
	open,
	folioName,
	currency,
	outstandingAmount,
	onClose,
	onSettled,
}: Props) {
	const [rows, setRows] = useState<LocalRow[]>(() => initialRows(outstandingAmount));
	const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
		makeSettlementIdempotencyKey(folioName)
	);
	const [submitting, setSubmitting] = useState(false);
	const [blockers, setBlockers] = useState<FolioMessage[]>([]);
	const [warnings, setWarnings] = useState<FolioMessage[]>([]);

	const totalAllocated = useMemo(
		() => rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0),
		[rows]
	);
	const variance = totalAllocated - outstandingAmount;

	function addRow() {
		setRows((prev) => [
			...prev,
			{
				id: `row-${prev.length}-${Date.now()}`,
				payment_kind: "Cash",
				amount: "0",
				payment_mode: "",
				reference_no: "",
			},
		]);
	}

	function removeRow(id: string) {
		setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
	}

	function updateRow(id: string, patch: Partial<LocalRow>) {
		setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
	}

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		setSubmitting(true);
		setBlockers([]);
		setWarnings([]);

		const payments: SettlementPaymentInput[] = rows
			.map((r) => ({
				payment_kind: r.payment_kind,
				amount: parseFloat(r.amount) || 0,
				payment_mode: r.payment_mode.trim() || null,
				reference_no: r.reference_no.trim() || null,
			}))
			.filter((p) => p.amount > 0);

		try {
			const envelope = await settleFolio({
				guest_folio: folioName,
				payments,
				idempotency_key: idempotencyKey,
			});
			if (envelope.ok === false) {
				setBlockers(envelope.blockers ?? []);
				setWarnings(envelope.warnings ?? []);
				setSubmitting(false);
				return;
			}
			toast.success("Folio settled", {
				description: envelope.data?.sales_invoice ?? folioName,
			});
			setSubmitting(false);
			// Fresh key for any subsequent settlement (e.g. partial settlement scenario)
			setIdempotencyKey(makeSettlementIdempotencyKey(folioName));
			onSettled();
			onClose();
		} catch (error) {
			setSubmitting(false);
			if (error instanceof FolioApiError) {
				setBlockers(error.blockers);
				setWarnings(error.warnings);
				if (error.blockers.length === 0) {
					toast.error("Couldn't settle folio", {
						description: "Check your connection and try again.",
					});
				}
			} else {
				toast.error("Couldn't settle folio", {
					description: "Unexpected error — try again.",
				});
			}
		}
	}

	return (
		<Sheet
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<SheetContent side="right" className="sm:max-w-lg">
				<SheetHeader>
					<SheetTitle>Prepare settlement</SheetTitle>
					<SheetDescription>
						<span className="font-mono">{folioName}</span> · Allocates payments and posts a
						submitted Sales Invoice + Payment Entry through ERPNext.
					</SheetDescription>
				</SheetHeader>

				<form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
					<div className="rounded-md border bg-muted/30 p-3 text-sm">
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground">Outstanding</span>
							<span className="font-semibold tabular-nums">
								{formatCurrency(outstandingAmount, currency)}
							</span>
						</div>
						<Separator className="my-2" />
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground">Allocated</span>
							<span className="font-semibold tabular-nums">
								{formatCurrency(totalAllocated, currency)}
							</span>
						</div>
						<div className="mt-1 flex items-center justify-between">
							<span className="text-muted-foreground">Variance</span>
							<span
								className={`font-semibold tabular-nums ${
									Math.abs(variance) < 0.005
										? "text-emerald-700 dark:text-emerald-400"
										: "text-amber-700 dark:text-amber-300"
								}`}
							>
								{formatCurrency(variance, currency)}
							</span>
						</div>
					</div>

					<div className="flex flex-col gap-3">
						{rows.map((row) => (
							<div key={row.id} className="rounded-md border p-3">
								<div className="grid grid-cols-[1fr_auto] gap-2">
									<div className="flex flex-col gap-1.5">
										<Label className="text-xs">Payment kind</Label>
										<Select
											value={row.payment_kind}
											onValueChange={(v) =>
												updateRow(row.id, { payment_kind: v as SettlementPaymentKind })
											}
										>
											<SelectTrigger className="h-9">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{PAYMENT_KINDS.map((kind) => (
													<SelectItem key={kind} value={kind}>
														{kind}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={rows.length === 1}
										onClick={() => removeRow(row.id)}
										aria-label="Remove payment"
									>
										<Trash2 className="size-4" />
									</Button>
								</div>
								<div className="mt-2 grid grid-cols-2 gap-2">
									<div className="flex flex-col gap-1.5">
										<Label className="text-xs">Amount ({currency})</Label>
										<Input
											type="number"
											step="0.01"
											min="0"
											value={row.amount}
											onChange={(e) => updateRow(row.id, { amount: e.target.value })}
										/>
									</div>
									<div className="flex flex-col gap-1.5">
										<Label className="text-xs">Mode of Payment</Label>
										<Input
											placeholder="Cash / HDFC / Razorpay"
											value={row.payment_mode}
											onChange={(e) =>
												updateRow(row.id, { payment_mode: e.target.value })
											}
										/>
									</div>
								</div>
								<div className="mt-2 flex flex-col gap-1.5">
									<Label className="text-xs">Reference</Label>
									<Input
										placeholder="Cheque / txn / receipt no."
										value={row.reference_no}
										onChange={(e) =>
											updateRow(row.id, { reference_no: e.target.value })
										}
									/>
								</div>
							</div>
						))}
						<Button type="button" variant="outline" size="sm" onClick={addRow}>
							<Plus className="mr-2 size-4" /> Add payment
						</Button>
					</div>

					{(blockers.length > 0 || warnings.length > 0) && (
						<div className="flex flex-col gap-2">
							{blockers.map((b) => (
								<Issue key={`b-${b.code}`} message={b} tone="danger" />
							))}
							{warnings.map((w) => (
								<Issue key={`w-${w.code}`} message={w} tone="warning" />
							))}
						</div>
					)}

					<SheetFooter className="mt-2">
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={submitting}>
							{submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
							Settle &amp; post
						</Button>
					</SheetFooter>
				</form>
			</SheetContent>
		</Sheet>
	);
}

function initialRows(outstanding: number): LocalRow[] {
	return [
		{
			id: "row-0",
			payment_kind: "Cash",
			amount: outstanding > 0 ? outstanding.toFixed(2) : "0",
			payment_mode: "Cash",
			reference_no: "",
		},
	];
}

function Issue({
	message,
	tone,
}: {
	message: FolioMessage;
	tone: "danger" | "warning";
}) {
	const accent =
		tone === "danger"
			? "border-destructive/50 bg-destructive/10 text-destructive"
			: "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200";
	return (
		<div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${accent}`}>
			<AlertTriangle className="mt-0.5 size-4 shrink-0" />
			<div className="flex flex-col">
				<span className="font-mono text-xs">{message.code}</span>
				<span>{message.message}</span>
			</div>
		</div>
	);
}
