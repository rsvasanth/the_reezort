/**
 * My Day — non-manager landing (#/my-day). Clock + shift + open tasks +
 * quick request links + latest payslip (spec 008, ui-ux-my-day).
 */

import { useCallback, useEffect, useState } from "react";
import { Clock, Download, Loader2, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FolioApiError, getMyDay, getSlip, listMySlips, selfClockIn, selfClockOut, type MyDay, type MySlips, type PayslipRow } from "@/lib/staff-api";
import { listMyLeaves, listMyAdvances, type LeaveBalance, type MyLeaves, type MyAdvances } from "@/lib/staff-api";
import { downloadPayslipPdf } from "@/lib/payslip-pdf";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function greeting(): string {
	const h = new Date().getHours();
	if (h < 12) return "Good morning";
	if (h < 17) return "Good afternoon";
	return "Good evening";
}

function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function fmtTime(iso: string | null): string {
	if (!iso) return "—";
	const t = iso.includes(" ") ? iso.split(" ")[1] : iso;
	return t ? t.slice(0, 5) : "—";
}

export default function MyDayScreen() {
	const [day, setDay] = useState<MyDay | null>(null);
	const [slips, setSlips] = useState<MySlips | null>(null);
	const [leaves, setLeaves] = useState<MyLeaves | null>(null);
	const [advances, setAdvances] = useState<MyAdvances | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	const reload = useCallback(async () => {
		try {
			const [d, s, l, a] = await Promise.all([
				getMyDay(),
				listMySlips(),
				listMyLeaves().catch(() => null),
				listMyAdvances().catch(() => null),
			]);
			setDay(d);
			setSlips(s);
			setLeaves(l);
			setAdvances(a);
		} catch (error) {
			reportError(error, "Could not load My Day");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { reload(); }, [reload]);

	async function onClockToggle() {
		if (!day) return;
		setBusy(true);
		try {
			if (day.clocked === "IN") {
				await selfClockOut();
				toast.success("Clocked out");
			} else {
				await selfClockIn();
				toast.success("Clocked in");
			}
			await reload();
		} catch (error) {
			reportError(error, "Clock action failed");
		} finally {
			setBusy(false);
		}
	}

	async function onDownloadLatestSlip(name: string) {
		try {
			const res = await getSlip(name);
			downloadPayslipPdf(res.slip);
			toast.success("Payslip.pdf saved");
		} catch (error) {
			reportError(error, "PDF failed");
		}
	}

	if (loading) {
		return (
			<div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading My Day…
			</div>
		);
	}

	const latestSlip: PayslipRow | null = slips?.slips?.[0] ?? null;
	const topBalances = (leaves?.balances ?? []).slice(0, 3);
	const outstanding = advances?.outstanding ?? 0;
	const firstName = (day?.employee_name?.split(" ")[0] ?? day?.user ?? "").trim();

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6" data-testid="my-day-screen">
			<header>
				<Badge variant="outline" className="mb-2">My day</Badge>
				<h1 className="text-3xl font-light text-foreground md:text-4xl">
					{greeting()}{firstName ? `, ${firstName}` : ""}
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					{day?.designation ?? "Staff"}
					{day?.date ? ` · ${day.date}` : ""}
				</p>
			</header>

			{!day?.employee ? (
				<Card><CardContent className="py-8 text-sm text-muted-foreground">
					Your login is not linked to an Employee record — ask a manager to link it.
				</CardContent></Card>
			) : (
				<Card>
					<CardContent className="flex flex-col items-start gap-3 py-4 md:flex-row md:items-center md:justify-between">
						<div className="flex items-center gap-3">
							<Clock className="size-5 text-muted-foreground" />
							<div>
								<div className="text-sm font-medium">
									{day.clocked === "IN"
										? `You are In since ${fmtTime(day.last_time)}`
										: day.clocked === "OUT"
										? `You are Out since ${fmtTime(day.last_time)}`
										: "Ready to start? Tap Clock in."}
								</div>
								<div className="text-xs text-muted-foreground">Open tasks: {day.open_tasks}</div>
							</div>
						</div>
						<Button
							size="lg"
							onClick={onClockToggle}
							disabled={busy}
							data-testid="my-day-clock-btn"
							variant={day.clocked === "IN" ? "outline" : "default"}
						>
							{busy ? <Loader2 className="size-4 animate-spin" /> : day.clocked === "IN" ? <LogOut className="size-4" /> : <LogIn className="size-4" />}
							{day.clocked === "IN" ? "Clock out" : "Clock in"}
						</Button>
					</CardContent>
				</Card>
			)}

			<section className="grid gap-3 md:grid-cols-3">
				{topBalances.map((b: LeaveBalance) => (
					<Card key={b.leave_type}>
						<CardContent className="py-4">
							<div className="text-xs text-muted-foreground">{b.leave_type} balance</div>
							<div className="mt-1 text-2xl font-light">
								{b.remaining_days} <span className="text-sm text-muted-foreground">/ {b.max_days}</span>
							</div>
							<div className="text-xs text-muted-foreground">remaining</div>
						</CardContent>
					</Card>
				))}
				{advances ? (
					<Card>
						<CardContent className="py-4">
							<div className="text-xs text-muted-foreground">Outstanding advance</div>
							<div className="mt-1 text-2xl font-light">{formatINR(outstanding)}</div>
							<div className="text-xs text-muted-foreground">cap {formatINR(advances.cap)}</div>
						</CardContent>
					</Card>
				) : null}
			</section>

			<section className="flex flex-wrap gap-2">
				<Button variant="secondary" asChild data-testid="link-leaves">
					<a href="#/attendance">Request leave</a>
				</Button>
				<Button variant="secondary" asChild data-testid="link-advances">
					<a href="#/attendance">Request advance</a>
				</Button>
				{day?.open_tasks ? (
					<Button variant="secondary" asChild data-testid="link-tasks">
						<a href="#/my-tasks">Open tasks ({day.open_tasks})</a>
					</Button>
				) : null}
			</section>

			{latestSlip ? (
				<Card>
					<CardContent className="flex flex-col gap-2 py-4 md:flex-row md:items-center md:justify-between">
						<div>
							<div className="text-xs text-muted-foreground">Latest payslip</div>
							<div className="mt-1 text-sm font-medium">{latestSlip.end_date} · {latestSlip.salary_structure ?? "—"}</div>
							<div className="text-xs text-muted-foreground">
								Gross {formatINR(latestSlip.gross_pay)} · Net {formatINR(latestSlip.net_pay)}
							</div>
						</div>
						<Button size="sm" onClick={() => onDownloadLatestSlip(latestSlip.name)} data-testid="my-day-download-slip">
							<Download className="size-4" /> Download PDF
						</Button>
					</CardContent>
				</Card>
			) : null}
		</main>
	);
}
