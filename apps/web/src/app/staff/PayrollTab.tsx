/**
 * Payroll tab — self payslip list + manager payroll run
 * (spec 008, ui-ux-payroll-tab).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, PlayCircle, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	FolioApiError,
	getSlip,
	listMySlips,
	previewPayroll,
	runPayroll,
	submitPayroll,
	type MySlips,
	type PayrollPreview,
	type PayrollRunResult,
	type PayslipRow,
} from "@/lib/staff-api";
import { downloadPayslipPdf } from "@/lib/payslip-pdf";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function firstDayOfCurrentMonth(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function downloadSlipByName(name: string) {
	try {
		const res = await getSlip(name);
		downloadPayslipPdf(res.slip);
		toast.success("Payslip.pdf saved");
	} catch (error) {
		reportError(error, "PDF failed");
	}
}

export default function PayrollTab() {
	const [my, setMy] = useState<MySlips | null>(null);
	const [loading, setLoading] = useState(true);

	const reload = useCallback(async () => {
		try {
			setMy(await listMySlips());
		} catch (error) {
			reportError(error, "Could not load payslips");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { reload(); }, [reload]);

	if (loading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading payroll…
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6" data-testid="payroll-tab">
			<SelfPane my={my} onDownload={downloadSlipByName} />
			{my?.is_manager ? <ManagerPane onRunSubmitted={reload} /> : null}
		</div>
	);
}

function SelfPane({ my, onDownload }: { my: MySlips | null; onDownload: (name: string) => Promise<void> }) {
	const latest = my?.slips?.[0] ?? null;
	return (
		<div className="flex flex-col gap-4">
			<h2 className="text-lg font-medium">My payslips</h2>

			{latest ? (
				<Card>
					<CardContent className="flex flex-col gap-2 py-4 md:flex-row md:items-center md:justify-between">
						<div>
							<div className="text-xs text-muted-foreground">Latest payslip</div>
							<div className="mt-1 text-sm font-medium">
								{latest.end_date} · {latest.salary_structure ?? "—"}
							</div>
							<div className="text-xs text-muted-foreground">
								Gross {formatINR(latest.gross_pay)} · Net {formatINR(latest.net_pay)}
							</div>
						</div>
						<Button size="sm" onClick={() => onDownload(latest.name)} data-testid={`download-latest-${latest.name}`}>
							<Download className="size-4" /> Download PDF
						</Button>
					</CardContent>
				</Card>
			) : (
				<Card><CardContent className="py-6 text-sm text-muted-foreground">
					No payslips yet — payroll will populate this once it runs.
				</CardContent></Card>
			)}

			{my?.slips.length ? (
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Period</TableHead>
								<TableHead>Structure</TableHead>
								<TableHead>Gross</TableHead>
								<TableHead>Net</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{my.slips.map((s: PayslipRow) => (
								<TableRow key={s.name} data-testid={`my-slip-${s.name}`}>
									<TableCell>{s.start_date ?? "—"} → {s.end_date ?? "—"}</TableCell>
									<TableCell>{s.salary_structure ?? "—"}</TableCell>
									<TableCell>{formatINR(s.gross_pay)}</TableCell>
									<TableCell>{formatINR(s.net_pay)}</TableCell>
									<TableCell className="text-right">
										<Button
											variant="ghost"
											size="icon"
											aria-label="Download PDF"
											onClick={() => onDownload(s.name)}
											data-testid={`download-slip-${s.name}`}
										>
											<Download className="size-4" />
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			) : null}
		</div>
	);
}

function ManagerPane({ onRunSubmitted }: { onRunSubmitted: () => Promise<void> }) {
	const [company, setCompany] = useState<string>("");
	const [period, setPeriod] = useState<string>(firstDayOfCurrentMonth());
	const [preview, setPreview] = useState<PayrollPreview | null>(null);
	const [run, setRun] = useState<PayrollRunResult | null>(null);
	const [previewing, setPreviewing] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	async function onPreview() {
		if (!company) { toast.error("Company is required"); return; }
		setPreviewing(true);
		try {
			const p = await previewPayroll({ company, period });
			setPreview(p);
			setRun(null);
		} catch (error) {
			reportError(error, "Preview failed");
		} finally {
			setPreviewing(false);
		}
	}

	async function onSubmit() {
		if (!company) return;
		setSubmitting(true);
		try {
			// Generate draft Payroll Entry + slips first (idempotent), then submit.
			const drafted = await runPayroll({ company, period });
			const submitted = await submitPayroll(drafted.payroll_entry);
			setRun(drafted);
			toast.success(
				`Payroll submitted · ${formatINR(submitted.total_net_pay)} across ${submitted.submitted_slip_count} slips`,
			);
			await onRunSubmitted();
		} catch (error) {
			reportError(error, "Submit failed");
		} finally {
			setSubmitting(false);
		}
	}

	const skippedBanner = useMemo(() => {
		if (!preview || preview.skipped_count <= 0) return null;
		return (
			<div className="rounded-md border border-warning bg-warning px-3 py-2 text-xs text-warning">
				{preview.skipped_count} employee{preview.skipped_count === 1 ? "" : "s"} skipped — assign structures first.
			</div>
		);
	}, [preview]);

	return (
		<div className="flex flex-col gap-4">
			<h2 className="text-lg font-medium">Run payroll</h2>

			<Card>
				<CardContent className="flex flex-col gap-3 py-4">
					<div className="grid gap-3 md:grid-cols-3">
						<div>
							<Label>Company</Label>
							<Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="THE REEZORT Private Limited" data-testid="run-company" />
						</div>
						<div>
							<Label>Period (YYYY-MM)</Label>
							<Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-07" data-testid="run-period" />
						</div>
						<div>
							<Label>Frequency</Label>
							<Input value="Monthly" disabled />
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={onPreview} disabled={previewing} data-testid="preview-btn">
							{previewing ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
							Preview slips
						</Button>
						<Button onClick={onSubmit} disabled={submitting || !preview} variant="default" data-testid="submit-btn">
							{submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
							Submit payroll
						</Button>
						{preview ? (
							<Badge variant="outline">
								Included {preview.included_count} · Skipped {preview.skipped_count}
							</Badge>
						) : null}
					</div>
					{skippedBanner}
				</CardContent>
			</Card>

			{preview && preview.slips_preview.length ? (
				<div>
					<h3 className="mb-2 text-sm font-medium">Preview</h3>
					<div className="rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Employee</TableHead>
									<TableHead>Structure</TableHead>
									<TableHead>Base</TableHead>
									<TableHead>Est. Gross</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{preview.slips_preview.map((r) => (
									<TableRow key={r.employee} data-testid={`preview-row-${r.employee}`}>
										<TableCell>{r.employee_name}</TableCell>
										<TableCell>{r.salary_structure}</TableCell>
										<TableCell>{formatINR(r.base)}</TableCell>
										<TableCell>{formatINR(r.gross_estimate)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			) : null}

			{run && run.slips.length ? (
				<div>
					<h3 className="mb-2 text-sm font-medium">Slips generated</h3>
					<div className="rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Employee</TableHead>
									<TableHead>Structure</TableHead>
									<TableHead>Gross</TableHead>
									<TableHead>Net</TableHead>
									<TableHead className="text-right">PDF</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{run.slips.map((r) => (
									<TableRow key={r.name} data-testid={`run-slip-${r.name}`}>
										<TableCell>{r.employee_name}</TableCell>
										<TableCell>{r.salary_structure ?? "—"}</TableCell>
										<TableCell>{r.gross_pay ? formatINR(r.gross_pay) : "—"}</TableCell>
										<TableCell>{r.net_pay ? formatINR(r.net_pay) : "—"}</TableCell>
										<TableCell className="text-right">
											<Button
												variant="ghost"
												size="icon"
												aria-label="Download PDF"
												onClick={() => downloadSlipByName(r.name)}
												data-testid={`download-run-${r.name}`}
											>
												<Download className="size-4" />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			) : null}
		</div>
	);
}
