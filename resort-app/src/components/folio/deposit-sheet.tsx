/**
 * Deposit / part-payment sheet — take an advance against the folio.
 * Records a real Payment Entry + reduces the folio's outstanding.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { FolioApiError, recordDeposit } from "@/lib/folio-api";

const MODES = ["Cash", "Razorpay", "Credit Card", "Bank Transfer"];

export function DepositSheet({
	open,
	folioName,
	currency,
	onClose,
	onRecorded,
}: {
	open: boolean;
	folioName: string;
	currency: string;
	onClose: () => void;
	onRecorded: () => void;
}) {
	const [amount, setAmount] = useState("");
	const [mode, setMode] = useState("Cash");
	const [busy, setBusy] = useState(false);

	async function save() {
		const value = parseFloat(amount);
		if (!value || value <= 0) {
			toast.error("Enter a deposit amount");
			return;
		}
		setBusy(true);
		try {
			const res = await recordDeposit({
				guest_folio: folioName,
				amount: value,
				mode_of_payment: mode,
				idempotency_key: crypto.randomUUID(),
			});
			toast.success("Deposit recorded", {
				description: `Outstanding now ${currency} ${res.data?.outstanding ?? "—"}`,
			});
			setAmount("");
			onRecorded();
			onClose();
		} catch (error) {
			const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not record deposit", { description: detail });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 sm:max-w-sm" data-testid="deposit-sheet">
				<SheetHeader>
					<SheetTitle>Record deposit</SheetTitle>
					<SheetDescription>Advance / part-payment against {folioName}.</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-3 px-4 py-4">
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">Amount ({currency})</Label>
						<Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="deposit-amount" />
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-sm">Mode</Label>
						<Select value={mode} onValueChange={setMode}>
							<SelectTrigger data-testid="deposit-mode"><SelectValue /></SelectTrigger>
							<SelectContent>
								{MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
							</SelectContent>
						</Select>
					</div>
				</div>
				<SheetFooter>
					<Button onClick={save} disabled={busy} data-testid="deposit-save">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Record deposit
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
