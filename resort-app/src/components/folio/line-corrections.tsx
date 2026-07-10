/**
 * Folio Line Corrections — built to specs/004/ui-ux-corrections-modal.md.
 *
 * Renders a ⋯ menu on each Folio Line row. Menu items appear per the line's
 * status + type. Each action opens a Sheet with a required reason input and
 * action-specific fields, then calls the matching endpoint on
 * billing.corrections. Success toast + row-status update + folio totals reload.
 */

import { useEffect, useState } from "react";
import { FileMinus, Loader2, MoreHorizontal, ReceiptText, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Skeleton } from "@/components/ui/skeleton";

import {
	FolioApiError,
	getActiveFolios,
	postCreditNote,
	postRefund,
	transferFolioLine,
	voidFolioLine,
	type ActiveFolioSummary,
	type FolioLine,
} from "@/lib/folio-api";
import { formatCurrency } from "./folio-format";

// The spec's status/type gates — kept as constants so tests can import them.
const CORRECTIBLE = new Set(["Draft", "Open", "Routed"]);
const REFUNDABLE_TYPES = new Set(["Payment Reference", "Deposit Application"]);
const PAYMENT_MODES = ["Cash", "Razorpay", "Credit Card", "Bank Transfer", "UPI"];

type Action = "void" | "transfer" | "credit" | "refund";

export function LineCorrectionsMenu({
	line,
	currency,
	onCorrected,
}: {
	line: FolioLine;
	currency: string;
	onCorrected: () => void;
}) {
	const [open, setOpen] = useState<Action | null>(null);

	const canVoid = CORRECTIBLE.has(line.line_status);
	const canTransfer = CORRECTIBLE.has(line.line_status);
	const canCredit = line.line_status === "Posted" && !!line.erpnext_sales_invoice;
	const canRefund =
		REFUNDABLE_TYPES.has(line.line_type)
		&& line.line_status !== "Refunded"
		&& !!line.erpnext_payment_entry;

	if (!canVoid && !canTransfer && !canCredit && !canRefund) return null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="icon"
						variant="ghost"
						className="size-7"
						aria-label={`Corrections for ${line.description ?? line.name}`}
						data-testid={`corr-menu-${line.name}`}
					>
						<MoreHorizontal className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{canVoid && (
						<DropdownMenuItem onClick={() => setOpen("void")}>
							<Trash2 className="mr-2 size-4" /> Void line
						</DropdownMenuItem>
					)}
					{canTransfer && (
						<DropdownMenuItem onClick={() => setOpen("transfer")}>
							<FileMinus className="mr-2 size-4" /> Transfer to another folio
						</DropdownMenuItem>
					)}
					{canCredit && (
						<DropdownMenuItem onClick={() => setOpen("credit")}>
							<ReceiptText className="mr-2 size-4" /> Issue credit note
						</DropdownMenuItem>
					)}
					{canRefund && (
						<DropdownMenuItem onClick={() => setOpen("refund")}>
							<RotateCcw className="mr-2 size-4" /> Refund payment
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{open === "void" && (
				<VoidSheet line={line} currency={currency} onClose={() => setOpen(null)} onDone={onCorrected} />
			)}
			{open === "transfer" && (
				<TransferSheet line={line} currency={currency} onClose={() => setOpen(null)} onDone={onCorrected} />
			)}
			{open === "credit" && (
				<CreditNoteSheet line={line} currency={currency} onClose={() => setOpen(null)} onDone={onCorrected} />
			)}
			{open === "refund" && (
				<RefundSheet line={line} currency={currency} onClose={() => setOpen(null)} onDone={onCorrected} />
			)}
		</>
	);
}

// ---------- shared building blocks ----------

function ContextRow({ line, currency }: { line: FolioLine; currency: string }) {
	return (
		<div className="rounded-md border bg-muted/30 p-3 text-sm">
			<div className="font-medium">{line.description}</div>
			<div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
				<span>{line.line_type}</span>
				<span>·</span>
				<span className="font-semibold text-foreground">{formatCurrency(line.amount, currency)}</span>
				<span>·</span>
				<span>{line.line_status}</span>
			</div>
		</div>
	);
}

function WarningStrip({ text }: { text: string }) {
	return (
		<div className="rounded-md border border-[#b28600]/40 bg-[#b28600]/10 p-2 text-xs text-[#483700] dark:text-[#fddc69]">
			⚠ {text}
			<div className="mt-0.5 text-[10px] opacity-80">An Audit Event will be recorded.</div>
		</div>
	);
}

async function runCorrection(
	label: string,
	fn: () => Promise<unknown>,
	onSuccess: () => void,
	onError: (msg: string) => void,
) {
	try {
		await fn();
		toast.success(label);
		onSuccess();
	} catch (error) {
		const detail =
			error instanceof FolioApiError && error.blockers.length > 0
				? error.blockers.map((b) => b.message).join("; ")
				: error instanceof Error
					? error.message
					: "Unknown error";
		toast.error(`${label.replace(/ (posted|voided|refunded|transferred).*$/i, "")} failed`, { description: detail });
		onError(detail);
	}
}

// ---------- Void ----------

function VoidSheet({ line, currency, onClose, onDone }: SheetProps) {
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);

	async function confirm() {
		if (!reason.trim()) return;
		setBusy(true);
		await runCorrection(
			"Line voided",
			() => voidFolioLine({ line: line.name, reason: reason.trim() }),
			() => { onDone(); onClose(); },
			() => setBusy(false),
		);
	}

	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent data-testid="corr-void-sheet">
				<SheetHeader>
					<SheetTitle>Void folio line</SheetTitle>
					<SheetDescription>This will mark the line as voided and zero its amount. Auditable.</SheetDescription>
				</SheetHeader>
				<div className="mt-4 flex flex-col gap-4">
					<ContextRow line={line} currency={currency} />
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="void-reason">Reason <span className="text-destructive">*</span></Label>
						<Input
							id="void-reason"
							autoFocus
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="e.g. Duplicate charge"
							data-testid="corr-void-reason"
						/>
					</div>
					<WarningStrip text="This is a permanent audit event." />
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button variant="destructive" onClick={confirm} disabled={busy || !reason.trim()} data-testid="corr-void-confirm">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Void line
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ---------- Transfer ----------

function TransferSheet({ line, currency, onClose, onDone }: SheetProps) {
	const [reason, setReason] = useState("");
	const [folios, setFolios] = useState<ActiveFolioSummary[] | null>(null);
	const [target, setTarget] = useState<string>("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		getActiveFolios(50)
			.then((env) => setFolios((env.data?.folios ?? []).filter((f) => f.name !== line.guest_folio)))
			.catch(() => setFolios([]));
	}, [line.guest_folio]);

	async function confirm() {
		if (!reason.trim() || !target) return;
		setBusy(true);
		await runCorrection(
			`Line transferred to ${target}`,
			() => transferFolioLine({ line: line.name, target_folio: target, reason: reason.trim() }),
			() => { onDone(); onClose(); },
			() => setBusy(false),
		);
	}

	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent data-testid="corr-transfer-sheet">
				<SheetHeader>
					<SheetTitle>Transfer folio line</SheetTitle>
					<SheetDescription>Move this line to another open folio. The original line becomes read-only.</SheetDescription>
				</SheetHeader>
				<div className="mt-4 flex flex-col gap-4">
					<ContextRow line={line} currency={currency} />
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="transfer-target">Target folio <span className="text-destructive">*</span></Label>
						{folios === null ? (
							<Skeleton className="h-9 w-full" />
						) : folios.length === 0 ? (
							<p className="text-sm text-muted-foreground">No other open folios found.</p>
						) : (
							<Select value={target} onValueChange={setTarget}>
								<SelectTrigger id="transfer-target" data-testid="corr-transfer-target"><SelectValue placeholder="Choose folio…" /></SelectTrigger>
								<SelectContent>
									{folios.map((f) => (
										<SelectItem key={f.name} value={f.name}>
											{f.guest} · {f.name} {f.room ? `· ${f.room}` : ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="transfer-reason">Reason <span className="text-destructive">*</span></Label>
						<Input
							id="transfer-reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="e.g. Corporate split billing"
							data-testid="corr-transfer-reason"
						/>
					</div>
					<WarningStrip text="This is a permanent audit event." />
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button onClick={confirm} disabled={busy || !target || !reason.trim()} data-testid="corr-transfer-confirm">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <FileMinus className="size-4" />} Transfer
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ---------- Credit note ----------

function CreditNoteSheet({ line, currency, onClose, onDone }: SheetProps) {
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);

	async function confirm() {
		if (!reason.trim()) return;
		setBusy(true);
		await runCorrection(
			"Credit note posted",
			() => postCreditNote({ line: line.name, reason: reason.trim() }),
			() => { onDone(); onClose(); },
			() => setBusy(false),
		);
	}

	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent data-testid="corr-credit-sheet">
				<SheetHeader>
					<SheetTitle>Issue credit note</SheetTitle>
					<SheetDescription>
						Posts an ERPNext return Sales Invoice against <span className="font-mono">{line.erpnext_sales_invoice}</span>. Balances update.
					</SheetDescription>
				</SheetHeader>
				<div className="mt-4 flex flex-col gap-4">
					<ContextRow line={line} currency={currency} />
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cn-reason">Reason <span className="text-destructive">*</span></Label>
						<Input
							id="cn-reason"
							autoFocus
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="e.g. Compensation for AC issue"
							data-testid="corr-credit-reason"
						/>
					</div>
					<WarningStrip text="This posts a submitted ERPNext return invoice." />
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button onClick={confirm} disabled={busy || !reason.trim()} data-testid="corr-credit-confirm">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <ReceiptText className="size-4" />} Post credit note
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ---------- Refund ----------

function RefundSheet({ line, currency, onClose, onDone }: SheetProps) {
	const [reason, setReason] = useState("");
	const [amount, setAmount] = useState(String(line.amount));
	const [mode, setMode] = useState<string>("Cash");
	const [busy, setBusy] = useState(false);

	async function confirm() {
		const amt = parseFloat(amount);
		if (!reason.trim() || !amt || amt <= 0 || amt > line.amount) return;
		setBusy(true);
		await runCorrection(
			`Refund of ${formatCurrency(amt, currency)} posted`,
			() => postRefund({ line: line.name, amount: amt, mode_of_payment: mode, reason: reason.trim() }),
			() => { onDone(); onClose(); },
			() => setBusy(false),
		);
	}

	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent data-testid="corr-refund-sheet">
				<SheetHeader>
					<SheetTitle>Refund payment</SheetTitle>
					<SheetDescription>
						Posts an ERPNext Payment Entry (Pay type) against <span className="font-mono">{line.erpnext_payment_entry}</span>.
					</SheetDescription>
				</SheetHeader>
				<div className="mt-4 flex flex-col gap-4">
					<ContextRow line={line} currency={currency} />
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="refund-amount">Amount ({currency}) <span className="text-destructive">*</span></Label>
							<Input
								id="refund-amount"
								type="number"
								min="0"
								max={line.amount}
								step="0.01"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								data-testid="corr-refund-amount"
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="refund-mode">Mode of payment</Label>
							<Select value={mode} onValueChange={setMode}>
								<SelectTrigger id="refund-mode"><SelectValue /></SelectTrigger>
								<SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
							</Select>
						</div>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="refund-reason">Reason <span className="text-destructive">*</span></Label>
						<Input
							id="refund-reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="e.g. Guest cancelled"
							data-testid="corr-refund-reason"
						/>
					</div>
					<WarningStrip text="This posts a submitted ERPNext refund Payment Entry." />
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button
						onClick={confirm}
						disabled={busy || !reason.trim() || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > line.amount}
						data-testid="corr-refund-confirm"
					>
						{busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
						Refund {amount && parseFloat(amount) > 0 ? formatCurrency(parseFloat(amount), currency) : ""}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

type SheetProps = {
	line: FolioLine;
	currency: string;
	onClose: () => void;
	onDone: () => void;
};
