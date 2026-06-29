import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import type { BalanceStatus, FolioTotals } from "@/lib/folio-api";

import { formatCurrency } from "./folio-format";

type Props = {
	totals?: FolioTotals;
	balanceStatus?: BalanceStatus;
	currency: string;
};

export function FolioTotalsStrip({ totals, balanceStatus, currency }: Props) {
	if (!totals) {
		return (
			<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
				{Array.from({ length: 5 }).map((_, i) => (
					<Card key={i}>
						<CardContent className="p-4">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="mt-3 h-6 w-28" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	const outstandingAccent = outstandingTone(balanceStatus);

	return (
		<TooltipProvider>
			<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
				<Tile label="Charges" value={formatCurrency(totals.total_charges, currency)} />
				<Tile
					label="Discounts"
					value={
						totals.total_discounts > 0
							? `−${formatCurrency(totals.total_discounts, currency).replace(/^−/, "")}`
							: formatCurrency(totals.total_discounts, currency)
					}
				/>
				<Tooltip>
					<TooltipTrigger asChild>
						<div>
							<Tile
								label="Taxes (est.)"
								value={formatCurrency(totals.total_taxes_estimated, currency)}
							/>
						</div>
					</TooltipTrigger>
					<TooltipContent>Estimate before ERPNext posting.</TooltipContent>
				</Tooltip>
				<Tile label="Paid" value={formatCurrency(totals.total_paid, currency)} />
				<Tile
					label="Outstanding"
					value={formatCurrency(totals.outstanding_amount, currency)}
					accentClassName={outstandingAccent}
				/>
			</div>
		</TooltipProvider>
	);
}

function Tile({
	label,
	value,
	accentClassName,
}: {
	label: string;
	value: string;
	accentClassName?: string;
}) {
	return (
		<Card className={accentClassName}>
			<CardContent className="p-4">
				<div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
				<div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
			</CardContent>
		</Card>
	);
}

function outstandingTone(status?: BalanceStatus): string | undefined {
	switch (status) {
		case "Outstanding":
			return "ring-2 ring-amber-500/60";
		case "Credit Balance":
			return "ring-2 ring-sky-500/60";
		case "Disputed":
			return "ring-2 ring-destructive/60";
		case "Settled":
		case "No Balance":
		default:
			return undefined;
	}
}
