/**
 * FolioLinesTable — the stay ledger.
 *
 * Day-grouped timeline of folio lines: posting time, department icon,
 * description with source/qty/rate detail, amount, and a posting dot
 * (green = Posted to ERPNext, brass = awaiting post). Line corrections
 * and role-masked ERPNext links carry over from the previous table
 * design unchanged.
 */

import { Fragment } from "react";
import {
	BedDouble,
	Building2,
	CarFront,
	PartyPopper,
	PenLine,
	Plug,
	Plus,
	ReceiptText,
	Shirt,
	Sparkles,
	UtensilsCrossed,
	Wine,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import type { FolioLine, LineStatus } from "@/lib/folio-api";

import { LineCorrectionsMenu } from "./line-corrections";
import { formatCurrency, formatServiceDate, groupLines } from "./folio-format";

type Props = {
	lines: FolioLine[];
	currency: string;
	showErpnextColumn: boolean;
	emptyAddLineVisible: boolean;
	onEmptyAddLine: () => void;
	onLineCorrected: () => void;
};

export function FolioLinesTable({
	lines,
	currency,
	showErpnextColumn,
	emptyAddLineVisible,
	onEmptyAddLine,
	onLineCorrected,
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
	const postedCount = lines.filter((l) => l.line_status === "Posted").length;
	const pendingCount = lines.filter((l) => l.line_status === "Open" || l.line_status === "Routed").length;

	return (
		<TooltipProvider>
			<div className="overflow-hidden rounded-xl border bg-card">
				<div className="flex items-baseline justify-between border-b px-5 py-4">
					<h2 className="font-display text-lg font-normal">Stay ledger</h2>
					<span className="text-xs text-muted-foreground">
						{lines.length} line{lines.length === 1 ? "" : "s"}
					</span>
				</div>

				{grouped.map((dateGroup) => {
					const dayLines = dateGroup.departments.flatMap((d) =>
						d.lines.map((line) => ({ line, department: d.department }))
					);
					const dateSubtotal = dayLines.reduce((sum, { line }) => sum + (line.amount ?? 0), 0);
					return (
						<Fragment key={dateGroup.date}>
							<div className="flex items-baseline justify-between px-5 pb-2 pt-4">
								<span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
									{formatServiceDate(dateGroup.date)}
								</span>
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="font-mono text-[11px] tabular-nums text-muted-foreground">
											Σ {formatCurrency(dateSubtotal, currency)}
										</span>
									</TooltipTrigger>
									<TooltipContent>
										Subtotal of lines shown — folio totals come from server.
									</TooltipContent>
								</Tooltip>
							</div>
							{dayLines.map(({ line, department }) => (
								<LedgerRow
									key={line.name}
									line={line}
									department={department}
									currency={currency}
									showErpnextLinks={showErpnextColumn}
									onLineCorrected={onLineCorrected}
								/>
							))}
						</Fragment>
					);
				})}

				<div className="flex items-center gap-4 border-t px-5 py-3 text-[11px] text-muted-foreground">
					<span className="inline-flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-emerald-500" />
						{postedCount} posted to ERPNext
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-brass" />
						{pendingCount} awaiting post
					</span>
				</div>
			</div>
		</TooltipProvider>
	);
}

function LedgerRow({
	line,
	department,
	currency,
	showErpnextLinks,
	onLineCorrected,
}: {
	line: FolioLine;
	department: string;
	currency: string;
	showErpnextLinks: boolean;
	onLineCorrected: () => void;
}) {
	const voided = line.line_status === "Voided";
	const DeptIcon = departmentIcon(department);
	const sourceLabel = line.source_doctype
		? `${line.source_module} · ${line.source_doctype}${line.source_name ? ` · ${line.source_name}` : ""}`
		: line.source_module;

	const detailParts: string[] = [];
	if (line.qty != null && Number.isFinite(line.qty) && line.rate != null && Number.isFinite(line.rate)) {
		detailParts.push(`${formatQty(line.qty)} × ${formatCurrency(line.rate, currency)}`);
	}
	if (line.discount_amount && line.discount_amount > 0) {
		detailParts.push(`−${formatCurrency(line.discount_amount, currency)} discount`);
	}
	if (line.tax_treatment !== "Standard") {
		detailParts.push(line.tax_treatment);
	}

	return (
		<div
			className={`grid grid-cols-[2.5rem_1.75rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 border-t px-5 py-3 transition-colors hover:bg-muted/40 ${voided ? "opacity-60" : ""}`}
		>
			<span className="font-mono text-[11px] text-muted-foreground">
				{formatCreationTime(line.creation)}
			</span>
			<Tooltip>
				<TooltipTrigger asChild>
					<div className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
						<DeptIcon className="size-3.5" />
					</div>
				</TooltipTrigger>
				<TooltipContent>{department}</TooltipContent>
			</Tooltip>
			<div className="min-w-0">
				<div className={`truncate text-sm font-medium ${voided ? "line-through" : ""}`}>
					{line.description}
					{line.line_type !== "Charge" && (
						<Badge variant="outline" className="ml-2 align-middle text-[10px] font-normal">
							{line.line_type}
						</Badge>
					)}
				</div>
				<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="cursor-help rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-[0.08em]">
								{line.source_module}
							</span>
						</TooltipTrigger>
						<TooltipContent>{sourceLabel}</TooltipContent>
					</Tooltip>
					{detailParts.length > 0 && <span>{detailParts.join(" · ")}</span>}
					{showErpnextLinks && <ErpnextLinks line={line} />}
				</div>
			</div>
			<span
				className={`font-mono text-sm font-medium tabular-nums ${voided ? "line-through" : ""}`}
			>
				{formatCurrency(line.amount, currency)}
			</span>
			<div className="flex items-center gap-1.5 justify-self-end">
				<Tooltip>
					<TooltipTrigger asChild>
						<span className={`size-1.5 rounded-full ${statusDotClass(line.line_status)}`} />
					</TooltipTrigger>
					<TooltipContent>{line.line_status}</TooltipContent>
				</Tooltip>
				<LineCorrectionsMenu line={line} currency={currency} onCorrected={onLineCorrected} />
			</div>
		</div>
	);
}

function statusDotClass(status: LineStatus): string {
	switch (status) {
		case "Posted":
			return "bg-emerald-500";
		case "Open":
		case "Routed":
			return "bg-brass ring-2 ring-brass/25";
		case "Credited":
		case "Refunded":
			return "bg-sky-500";
		case "Written Off":
			return "bg-amber-500";
		case "Draft":
		case "Voided":
		case "Transferred":
		default:
			return "bg-muted-foreground/40";
	}
}

function departmentIcon(department: string) {
	const key = department.toLowerCase();
	if (key.includes("room") || key.includes("lodg") || key.includes("stay")) return BedDouble;
	if (key.includes("restaurant") || key.includes("dining") || key.includes("f&b") || key.includes("food")) return UtensilsCrossed;
	if (key.includes("minibar") || key.includes("bar")) return Wine;
	if (key.includes("spa") || key.includes("wellness")) return Sparkles;
	if (key.includes("laundry") || key.includes("linen")) return Shirt;
	if (key.includes("transport") || key.includes("travel")) return CarFront;
	if (key.includes("event") || key.includes("banquet")) return PartyPopper;
	if (key.includes("manual")) return PenLine;
	if (key.includes("integration")) return Plug;
	if (key.includes("pms") || key.includes("front")) return Building2;
	return ReceiptText;
}

function ErpnextLinks({ line }: { line: FolioLine }) {
	const links = [
		{ label: "SI", value: line.erpnext_sales_invoice },
		{ label: "PE", value: line.erpnext_payment_entry },
		{ label: "CN", value: line.erpnext_credit_note },
		{ label: "JE", value: line.erpnext_journal_entry },
	].filter((entry) => entry.value);

	if (links.length === 0) return null;

	return (
		<span className="inline-flex flex-wrap gap-x-2">
			{links.map((entry) => (
				<a
					key={entry.label}
					href={`/app/${slugify(entry.label)}/${entry.value}`}
					className="font-mono text-foreground hover:underline"
				>
					<span className="text-muted-foreground">{entry.label}:</span> {entry.value}
				</a>
			))}
		</span>
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

function formatQty(qty: number): string {
	return Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
}

function formatCreationTime(creation?: string): string {
	if (!creation) return "";
	const d = new Date(creation.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
