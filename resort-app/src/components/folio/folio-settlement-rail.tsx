/**
 * FolioSettlementRail — balance hero + self-explaining equation + CTAs.
 *
 * Replaces FolioTotalsStrip. Instead of five equal tiles, the outstanding
 * amount is the single hero number and the other totals become the
 * equation that produces it (charges − discounts + taxes − paid), so the
 * math explains itself at the desk. Server totals remain the source of
 * truth — this component never re-sums lines.
 */

import { ArrowRight, FileDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import type { BalanceStatus, FolioLine, FolioTotals, PostingStatus } from "@/lib/folio-api";

import { balanceStatusBadge, formatCurrency, formatServiceDate } from "./folio-format";

const PAYMENT_LINE_TYPES = new Set(["Payment Reference", "Deposit Application", "Refund"]);

type Props = {
	totals?: FolioTotals;
	balanceStatus?: BalanceStatus;
	postingStatus?: PostingStatus;
	currency: string;
	lines: FolioLine[];
	showSettle: boolean;
	showInvoice: boolean;
	onSettle: () => void;
	onDownloadInvoice: () => void;
};

export function FolioSettlementRail({
	totals,
	balanceStatus,
	postingStatus,
	currency,
	lines,
	showSettle,
	showInvoice,
	onSettle,
	onDownloadInvoice,
}: Props) {
	if (!totals) {
		return (
			<Card>
				<CardContent className="p-5">
					<Skeleton className="h-3 w-32" />
					<Skeleton className="mt-3 h-10 w-40" />
					<Skeleton className="mt-5 h-24 w-full" />
				</CardContent>
			</Card>
		);
	}

	const balanceStyle = balanceStatus ? balanceStatusBadge(balanceStatus) : null;
	const chargeLineCount = lines.filter((l) => !PAYMENT_LINE_TYPES.has(l.line_type)).length;
	const postedCount = lines.filter((l) => l.line_status === "Posted").length;
	const paymentLines = lines.filter((l) => PAYMENT_LINE_TYPES.has(l.line_type));

	return (
		<div className="flex flex-col gap-4">
			<Card className="border-brass/30">
				<CardContent className="p-5">
					<div className="flex items-start justify-between gap-2">
						<div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brass">
							Balance due at settlement
						</div>
						{balanceStyle && balanceStatus && (
							<Badge variant={balanceStyle.variant} className={balanceStyle.className}>
								{balanceStatus}
							</Badge>
						)}
					</div>
					<div className="mt-2 font-display text-4xl font-light tabular-nums tracking-tight">
						{formatCurrency(totals.outstanding_amount, currency)}
					</div>

					<TooltipProvider>
						<dl className="mt-5 border-t text-sm">
							<EquationRow
								label="Charges"
								hint={`${chargeLineCount} line${chargeLineCount === 1 ? "" : "s"}`}
								value={formatCurrency(totals.total_charges, currency)}
							/>
							<EquationRow
								label="Discounts"
								value={`− ${formatCurrency(totals.total_discounts, currency)}`}
							/>
							<Tooltip>
								<TooltipTrigger asChild>
									<div>
										<EquationRow
											label="Taxes"
											hint="est."
											value={`+ ${formatCurrency(totals.total_taxes_estimated, currency)}`}
										/>
									</div>
								</TooltipTrigger>
								<TooltipContent>Estimate before ERPNext posting.</TooltipContent>
							</Tooltip>
							<EquationRow
								label="Paid to date"
								value={`− ${formatCurrency(totals.total_paid, currency)}`}
							/>
							<EquationRow
								label="Outstanding"
								value={formatCurrency(totals.outstanding_amount, currency)}
								emphasized
							/>
						</dl>
					</TooltipProvider>

					{showSettle && (
						<Button
							className="mt-4 w-full bg-brass text-brass-foreground hover:bg-brass/90"
							onClick={onSettle}
							data-testid="folio-settle"
						>
							Settle folio
							<ArrowRight className="ml-1.5 size-4" />
						</Button>
					)}
					{showInvoice && (
						<Button
							variant="outline"
							className="mt-2 w-full"
							onClick={onDownloadInvoice}
							data-testid="folio-download-invoice"
						>
							<FileDown className="mr-1.5 size-4" />
							Download tax invoice
						</Button>
					)}

					{postingStatus && (
						<div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
							<span className="size-1.5 shrink-0 rounded-full bg-[#24a148]" />
							{postedCount} of {lines.length} lines posted · ERPNext {postingStatus.toLowerCase()} · totals from server
						</div>
					)}
				</CardContent>
			</Card>

			{paymentLines.length > 0 && (
				<Card>
					<CardContent className="p-5">
						<h3 className="font-display text-base font-normal">Payments</h3>
						<div className="mt-0.5 text-[11px] text-muted-foreground">
							{formatCurrency(totals.total_paid, currency)} received
						</div>
						<div className="mt-2 divide-y">
							{paymentLines.map((line) => (
								<div key={line.name} className="flex items-center gap-3 py-2.5">
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">{line.description}</div>
										<div className="mt-0.5 text-[11px] text-muted-foreground">
											{formatServiceDate(line.service_date)} · {line.source_module}
										</div>
									</div>
									<span className="whitespace-nowrap font-mono text-xs tabular-nums text-[#24a148]">
										{formatCurrency(Math.abs(line.amount), currency)}
									</span>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

function EquationRow({
	label,
	hint,
	value,
	emphasized,
}: {
	label: string;
	hint?: string;
	value: string;
	emphasized?: boolean;
}) {
	return (
		<div className="flex items-baseline justify-between border-b py-2 last:border-b-0">
			<dt className={emphasized ? "font-semibold" : "text-muted-foreground"}>
				{label}
				{hint && <span className="ml-1.5 text-[11px] text-muted-foreground/70">{hint}</span>}
			</dt>
			<dd
				className={
					emphasized
						? "font-mono text-sm font-semibold tabular-nums text-brass"
						: "font-mono text-xs tabular-nums"
				}
			>
				{value}
			</dd>
		</div>
	);
}
