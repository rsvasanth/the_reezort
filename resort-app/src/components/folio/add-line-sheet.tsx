import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
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
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";

import {
	addFolioLine,
	FolioApiError,
	makeManualLineIdempotencyKey,
} from "@/lib/folio-api";
import type {
	AddLinePayload,
	FolioMessage,
	TaxTreatment,
} from "@/lib/folio-api";

type SheetMode = "form" | "submitting" | "success";

type Props = {
	open: boolean;
	folioName: string;
	currency: string;
	onClose: () => void;
	onLineAdded: () => void;
};

const TAX_TREATMENTS: TaxTreatment[] = [
	"Standard",
	"Exempt",
	"Zero Rated",
	"Inclusive",
	"Manual Review",
];

export function AddLineSheet({ open, folioName, currency, onClose, onLineAdded }: Props) {
	const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
		makeManualLineIdempotencyKey(folioName)
	);
	const [lineType, setLineType] = useState<"Charge" | "Discount" | "Adjustment">("Charge");
	const [serviceDate, setServiceDate] = useState<string>(() => today());
	const [itemCode, setItemCode] = useState<string>("");
	const [description, setDescription] = useState<string>("");
	const [qty, setQty] = useState<string>("1");
	const [rate, setRate] = useState<string>("0");
	const [amount, setAmount] = useState<string>("0");
	const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>("Standard");
	const [discountAmount, setDiscountAmount] = useState<string>("0");
	const [mode, setMode] = useState<SheetMode>("form");
	const [blockers, setBlockers] = useState<FolioMessage[]>([]);
	const [warnings, setWarnings] = useState<FolioMessage[]>([]);

	useEffect(() => {
		if (!open) return;
		// Fresh open ⇒ fresh key (only if we don't already have one from a prior retry)
		if (mode === "success") {
			resetForm();
		}
	}, [open]); // eslint-disable-line react-hooks/exhaustive-deps

	const showRate = lineType === "Charge";
	const showItem = lineType === "Charge";
	const showDiscount = lineType === "Charge";

	function resetForm(keepContext = false) {
		setIdempotencyKey(makeManualLineIdempotencyKey(folioName));
		setLineType(keepContext ? lineType : "Charge");
		setServiceDate(keepContext ? serviceDate : today());
		setItemCode("");
		setDescription("");
		setQty("1");
		setRate("0");
		setAmount("0");
		setTaxTreatment("Standard");
		setDiscountAmount("0");
		setMode("form");
		setBlockers([]);
		setWarnings([]);
	}

	function onQtyOrRateChange(nextQty: string, nextRate: string) {
		setQty(nextQty);
		setRate(nextRate);
		if (lineType === "Charge") {
			const q = parseFloat(nextQty);
			const r = parseFloat(nextRate);
			if (!Number.isNaN(q) && !Number.isNaN(r)) {
				setAmount((q * r).toFixed(2));
			}
		}
	}

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		setMode("submitting");
		setBlockers([]);
		setWarnings([]);

		const payload: AddLinePayload = {
			line_type: lineType,
			source_module: "Manual",
			idempotency_key: idempotencyKey,
			service_date: serviceDate,
			department: null,
			item_code: showItem ? itemCode.trim() || null : null,
			description: description.trim(),
			qty: parseFloat(qty) || 0,
			rate: showRate ? parseFloat(rate) || 0 : 0,
			amount: parseFloat(amount) || 0,
			tax_treatment: taxTreatment,
			discount_amount: showDiscount ? parseFloat(discountAmount) || 0 : 0,
		};

		try {
			const envelope = await addFolioLine(folioName, payload);
			if (envelope.ok === false) {
				setBlockers(envelope.blockers ?? []);
				setWarnings(envelope.warnings ?? []);
				setMode("form");
				return;
			}
			setWarnings(envelope.warnings ?? []);
			setMode("success");
			toast.success("Line added", {
				description: description.trim() || lineType,
			});
			onLineAdded();
		} catch (error) {
			if (error instanceof FolioApiError) {
				setBlockers(error.blockers);
				setWarnings(error.warnings);
				setMode("form");
				if (error.blockers.length === 0) {
					toast.error("Couldn't add line", {
						description: "Check your connection and try again.",
						action: {
							label: "Retry",
							onClick: () => {
								// Same idempotency_key — server dedups
								void onSubmit(new Event("submit") as unknown as FormEvent);
							},
						},
					});
				}
			} else {
				setMode("form");
				toast.error("Couldn't add line", {
					description: "Unexpected error — try again.",
				});
			}
		}
	}

	const submitDisabled = useMemo(
		() => mode === "submitting" || description.trim().length === 0,
		[mode, description]
	);

	return (
		<Sheet
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<SheetContent side="right" className="sm:max-w-lg">
				<SheetHeader>
					<SheetTitle>Add line to folio</SheetTitle>
					<SheetDescription>
						<span className="font-mono">{folioName}</span> · Manual entries are server-validated;
						approval-gated lines return a blocker if required.
					</SheetDescription>
				</SheetHeader>

				{mode === "success" ? (
					<SuccessBody
						onAddAnother={() => resetForm(true)}
						onDone={onClose}
						warnings={warnings}
					/>
				) : (
					<form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
						<Field label="Line type">
							<Select
								value={lineType}
								onValueChange={(v) => setLineType(v as typeof lineType)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="Charge">Charge</SelectItem>
									<SelectItem value="Discount">Discount</SelectItem>
									<SelectItem value="Adjustment">Adjustment</SelectItem>
								</SelectContent>
							</Select>
						</Field>

						<Field label="Service date">
							<Input
								type="date"
								value={serviceDate}
								onChange={(e) => setServiceDate(e.target.value)}
								required
							/>
						</Field>

						{showItem && (
							<Field label="Item code" hint="ERPNext Item — server validates.">
								<Input
									placeholder="e.g. ROOM-STD, FOOD-DINNER"
									value={itemCode}
									onChange={(e) => setItemCode(e.target.value)}
								/>
							</Field>
						)}

						<Field label="Description">
							<Input
								placeholder="What the guest is being billed for"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								required
							/>
						</Field>

						<div className="grid grid-cols-3 gap-3">
							<Field label="Qty">
								<Input
									type="number"
									min="0.01"
									step="0.01"
									value={qty}
									onChange={(e) => onQtyOrRateChange(e.target.value, rate)}
								/>
							</Field>
							{showRate && (
								<Field label={`Rate (${currency})`}>
									<Input
										type="number"
										step="0.01"
										value={rate}
										onChange={(e) => onQtyOrRateChange(qty, e.target.value)}
									/>
								</Field>
							)}
							<Field label={`Amount (${currency})`}>
								<Input
									type="number"
									step="0.01"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
								/>
							</Field>
						</div>

						<Field label="Tax treatment">
							<Select
								value={taxTreatment}
								onValueChange={(v) => setTaxTreatment(v as TaxTreatment)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TAX_TREATMENTS.map((t) => (
										<SelectItem key={t} value={t}>
											{t}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						{showDiscount && (
							<Field
								label={`Discount amount (${currency})`}
								hint="Over-threshold discounts may require approval."
							>
								<Input
									type="number"
									min="0"
									step="0.01"
									value={discountAmount}
									onChange={(e) => setDiscountAmount(e.target.value)}
								/>
							</Field>
						)}

						{(blockers.length > 0 || warnings.length > 0) && (
							<div className="flex flex-col gap-2">
								{blockers.map((b) => (
									<BlockerRow key={`b-${b.code}`} message={b} tone="danger" />
								))}
								{warnings.map((w) => (
									<BlockerRow key={`w-${w.code}`} message={w} tone="warning" />
								))}
							</div>
						)}

						<SheetFooter className="mt-2">
							<Button type="button" variant="ghost" onClick={onClose}>
								Cancel
							</Button>
							<Button type="submit" disabled={submitDisabled}>
								{mode === "submitting" && (
									<Loader2 className="mr-2 size-4 animate-spin" />
								)}
								Add line
							</Button>
						</SheetFooter>
					</form>
				)}
			</SheetContent>
		</Sheet>
	);
}

function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label>{label}</Label>
			{children}
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

function BlockerRow({
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

function SuccessBody({
	onAddAnother,
	onDone,
	warnings,
}: {
	onAddAnother: () => void;
	onDone: () => void;
	warnings: FolioMessage[];
}) {
	return (
		<div className="mt-6 flex flex-col gap-4">
			<div className="flex items-start gap-3 rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
				<CheckCircle2 className="mt-0.5 size-4" />
				<span>Line added — folio refreshed.</span>
			</div>
			{warnings.map((w) => (
				<BlockerRow key={`sw-${w.code}`} message={w} tone="warning" />
			))}
			<SheetFooter>
				<Button type="button" variant="ghost" onClick={onDone}>
					Done
				</Button>
				<Button type="button" onClick={onAddAnother}>
					Add another
				</Button>
			</SheetFooter>
		</div>
	);
}

function today(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}
