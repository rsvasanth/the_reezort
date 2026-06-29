import { Fragment } from "react";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import type { FolioLine } from "@/lib/folio-api";

import {
	formatCurrency,
	formatServiceDate,
	groupLines,
	lineStatusBadge,
} from "./folio-format";

type Props = {
	lines: FolioLine[];
	currency: string;
	showErpnextColumn: boolean;
	emptyAddLineVisible: boolean;
	onEmptyAddLine: () => void;
};

export function FolioLinesTable({
	lines,
	currency,
	showErpnextColumn,
	emptyAddLineVisible,
	onEmptyAddLine,
}: Props) {
	if (lines.length === 0) {
		return (
			<div className="rounded-xl border bg-card">
				<div className="flex flex-col items-center gap-3 p-12 text-center">
					<div className="rounded-full bg-muted p-3">
						<Plus className="size-5 text-muted-foreground" />
					</div>
					<div className="text-sm text-muted-foreground">
						No lines yet — post a charge to get started.
					</div>
					{emptyAddLineVisible && (
						<Button size="sm" onClick={onEmptyAddLine}>
							Add Line
						</Button>
					)}
				</div>
			</div>
		);
	}

	const grouped = groupLines(lines);
	const colCount = computeColCount(showErpnextColumn);

	return (
		<TooltipProvider>
			<div className="rounded-xl border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[35%]">Description</TableHead>
							<TableHead className="hidden md:table-cell">Source</TableHead>
							<TableHead className="text-right">Qty</TableHead>
							<TableHead className="text-right">Rate</TableHead>
							<TableHead className="text-right">Discount</TableHead>
							<TableHead className="text-right">Amount</TableHead>
							<TableHead>Status</TableHead>
							{showErpnextColumn && <TableHead>ERPNext</TableHead>}
						</TableRow>
					</TableHeader>
					<TableBody>
						{grouped.map((dateGroup) => {
							const dateSubtotal = dateGroup.departments
								.flatMap((d) => d.lines)
								.reduce((sum, l) => sum + (l.amount ?? 0), 0);
							return (
								<Fragment key={`d-${dateGroup.date}`}>
									<TableRow className="bg-muted/40 hover:bg-muted/40">
										<TableCell colSpan={colCount} className="py-2">
											<div className="flex items-center justify-between">
												<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
													{formatServiceDate(dateGroup.date)}
												</span>
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="text-xs tabular-nums text-muted-foreground">
															Σ {formatCurrency(dateSubtotal, currency)}
														</span>
													</TooltipTrigger>
													<TooltipContent>
														Subtotal of lines shown — folio totals come from server.
													</TooltipContent>
												</Tooltip>
											</div>
										</TableCell>
									</TableRow>
									{dateGroup.departments.map((deptGroup) => {
										const deptSubtotal = deptGroup.lines.reduce(
											(s, l) => s + (l.amount ?? 0),
											0
										);
										return (
											<Fragment key={`d-${dateGroup.date}-${deptGroup.department}`}>
												<TableRow className="hover:bg-transparent">
													<TableCell
														colSpan={colCount}
														className="py-1 pl-6 text-xs font-medium text-muted-foreground"
													>
														<div className="flex items-center justify-between">
															<span>{deptGroup.department}</span>
															<span className="tabular-nums">
																Σ {formatCurrency(deptSubtotal, currency)}
															</span>
														</div>
													</TableCell>
												</TableRow>
												{deptGroup.lines.map((line) => (
													<LineRow
														key={line.name}
														line={line}
														currency={currency}
														showErpnextColumn={showErpnextColumn}
													/>
												))}
											</Fragment>
										);
									})}
								</Fragment>
							);
						})}
					</TableBody>
				</Table>
			</div>
		</TooltipProvider>
	);
}

function computeColCount(showErpnext: boolean): number {
	// description, source(md+), qty, rate, discount, amount, status, (erpnext)
	return 7 + (showErpnext ? 1 : 0);
}

function LineRow({
	line,
	currency,
	showErpnextColumn,
}: {
	line: FolioLine;
	currency: string;
	showErpnextColumn: boolean;
}) {
	const statusStyle = lineStatusBadge(line.line_status);
	const voided = line.line_status === "Voided";
	const sourceLabel = line.source_doctype
		? `${line.source_module} · ${line.source_doctype}${line.source_name ? ` · ${line.source_name}` : ""}`
		: line.source_module;

	return (
		<TableRow className={voided ? "opacity-60" : undefined}>
			<TableCell className="align-top">
				<div className={voided ? "line-through" : undefined}>{line.description}</div>
				<div className="mt-1 flex flex-wrap gap-1">
					<Badge variant="outline" className="text-[10px] font-normal">
						{line.line_type}
					</Badge>
					<Badge variant="outline" className="text-[10px] font-normal">
						{line.tax_treatment}
					</Badge>
				</div>
			</TableCell>
			<TableCell className="hidden align-top text-xs text-muted-foreground md:table-cell">
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="line-clamp-2 cursor-help">{sourceLabel}</span>
					</TooltipTrigger>
					<TooltipContent>{sourceLabel}</TooltipContent>
				</Tooltip>
			</TableCell>
			<TableCell className="align-top text-right tabular-nums">
				{formatQty(line.qty)}
			</TableCell>
			<TableCell className="align-top text-right tabular-nums">
				{formatCurrency(line.rate, currency)}
			</TableCell>
			<TableCell className="align-top text-right tabular-nums text-muted-foreground">
				{line.discount_amount && line.discount_amount > 0
					? `−${formatCurrency(line.discount_amount, currency).replace(/^−/, "")}`
					: ""}
			</TableCell>
			<TableCell className="align-top text-right font-semibold tabular-nums">
				{formatCurrency(line.amount, currency)}
			</TableCell>
			<TableCell className="align-top">
				<Badge variant={statusStyle.variant} className={statusStyle.className}>
					{line.line_status}
				</Badge>
			</TableCell>
			{showErpnextColumn && (
				<TableCell className="align-top text-xs">
					<ErpnextLinks line={line} />
				</TableCell>
			)}
		</TableRow>
	);
}

function ErpnextLinks({ line }: { line: FolioLine }) {
	const links = [
		{ label: "SI", value: line.erpnext_sales_invoice },
		{ label: "PE", value: line.erpnext_payment_entry },
		{ label: "CN", value: line.erpnext_credit_note },
		{ label: "JE", value: line.erpnext_journal_entry },
	].filter((entry) => entry.value);

	if (links.length === 0) {
		return <span className="text-muted-foreground">—</span>;
	}

	return (
		<div className="flex flex-col gap-0.5">
			{links.map((entry) => (
				<a
					key={entry.label}
					href={`/app/${slugify(entry.label)}/${entry.value}`}
					className="font-mono text-foreground hover:underline"
				>
					<span className="text-muted-foreground">{entry.label}:</span> {entry.value}
				</a>
			))}
		</div>
	);
}

function slugify(label: string): string {
	switch (label) {
		case "SI":
			return "sales-invoice";
		case "PE":
			return "payment-entry";
		case "CN":
			return "sales-invoice"; // ERPNext credit note is a returned Sales Invoice
		case "JE":
			return "journal-entry";
		default:
			return label.toLowerCase();
	}
}

function formatQty(qty: number | null | undefined): string {
	// Real data can have nullish qty on non-Charge lines (Discount / Adjustment /
	// Payment Reference). Never let that crash the render.
	if (qty == null || !Number.isFinite(qty)) return "—";
	return Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
}
