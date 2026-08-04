/**
 * Attendance & Roster — clock in/out + daily attendance board (over hrms).
 * Manager view: each staff's shift, clock state, and Present/Absent marking.
 * Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";

import { GuestAvatar } from "@/components/guest-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import AdvancesTab from "./AdvancesTab";
import LeavesTab from "./LeavesTab";
import PayrollTab from "./PayrollTab";
import StructuresTab from "./StructuresTab";
import {
	FolioApiError,
	clockIn,
	clockOut,
	getAttendanceBoard,
	markAttendance,
	type AttendanceBoard,
} from "@/lib/staff-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function fmtTime(iso: string | null): string {
	if (!iso) return "—";
	const t = iso.includes(" ") ? iso.split(" ")[1] : iso;
	return t ? t.slice(0, 5) : "—";
}

// Local YYYY-MM-DD without pulling in a date lib.
function todayStr(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function AttendanceScreen() {
	const [date, setDate] = useState(todayStr());
	const [data, setData] = useState<AttendanceBoard | null>(null);
	const [loading, setLoading] = useState(true);
	const [denied, setDenied] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setData(await getAttendanceBoard(date));
		} catch (error) {
			if (error instanceof FolioApiError && error.status === 403) setDenied(true);
			else reportError(error, "Could not load attendance");
		} finally {
			setLoading(false);
		}
	}, [date]);

	useEffect(() => {
		reload();
	}, [reload]);

	async function act(employee: string, fn: () => Promise<unknown>, success: string) {
		setBusy(employee);
		try {
			await fn();
			toast.success(success);
			await reload();
		} catch (error) {
			reportError(error, "Action failed");
		} finally {
			setBusy(null);
		}
	}

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6" data-testid="attendance-screen">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<Badge variant="outline" className="mb-2">Attendance &amp; roster</Badge>
					<h1 className="text-3xl font-light text-foreground md:text-4xl">Attendance</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Clock staff in and out, see the roster, and mark daily attendance.
					</p>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label className="text-xs text-muted-foreground">Date</Label>
					<Input
						type="date"
						value={date}
						onChange={(e) => setDate(e.target.value)}
						className="w-44"
						data-testid="attendance-date"
					/>
				</div>
			</header>

			<Tabs defaultValue="roster" className="w-full">
				<TabsList data-testid="attendance-tabs">
					<TabsTrigger value="roster">Roster</TabsTrigger>
					<TabsTrigger value="leaves">Leaves</TabsTrigger>
					<TabsTrigger value="advances">Advances</TabsTrigger>
					<TabsTrigger value="structures">Structures</TabsTrigger>
					<TabsTrigger value="payroll">Payroll</TabsTrigger>
				</TabsList>
				<TabsContent value="roster" className="mt-4">
			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : denied ? (
				<Card><CardContent className="py-8 text-sm text-muted-foreground">
					You do not have permission to view attendance. Ask a manager.
				</CardContent></Card>
			) : (
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Staff</TableHead>
								<TableHead>Shift</TableHead>
								<TableHead>Clock</TableHead>
								<TableHead>Attendance</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.board.map((r) => (
								<TableRow key={r.employee} data-testid={`att-row-${r.employee}`}>
									<TableCell>
										<div className="flex items-center gap-3">
											<GuestAvatar name={r.employee_name} imageUrl={r.image} size="sm" />
											<div>
												<div className="font-medium">{r.employee_name}</div>
												<div className="text-xs text-muted-foreground">{r.designation ?? "—"}</div>
											</div>
										</div>
									</TableCell>
									<TableCell className="text-sm">{r.shift ?? "—"}</TableCell>
									<TableCell>
										{r.clocked === "IN" ? (
											<Badge variant="secondary">In · {fmtTime(r.last_time)}</Badge>
										) : r.clocked === "OUT" ? (
											<Badge variant="outline">Out · {fmtTime(r.last_time)}</Badge>
										) : (
											<span className="text-xs text-muted-foreground">Not clocked in</span>
										)}
									</TableCell>
									<TableCell>
										{r.attendance_status ? (
											<Badge variant={r.attendance_status === "Absent" ? "destructive" : "secondary"}>
												{r.attendance_status}
											</Badge>
										) : (
											<span className="text-xs text-muted-foreground">Not marked</span>
										)}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-1">
											<Button
												variant="ghost"
												size="icon"
												aria-label="Clock in"
												disabled={busy === r.employee}
												onClick={() => act(r.employee, () => clockIn(r.employee), `${r.employee_name} clocked in`)}
												data-testid={`clock-in-${r.employee}`}
											>
												<LogIn className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label="Clock out"
												disabled={busy === r.employee}
												onClick={() => act(r.employee, () => clockOut(r.employee), `${r.employee_name} clocked out`)}
											>
												<LogOut className="size-4" />
											</Button>
											<Select
												value={r.attendance_status ?? ""}
												onValueChange={(status) =>
													act(r.employee, () => markAttendance(r.employee, status, date), `Marked ${status}`)
												}
											>
												<SelectTrigger className="h-8 w-32" data-testid={`mark-${r.employee}`}>
													<SelectValue placeholder="Mark" />
												</SelectTrigger>
												<SelectContent>
													{(data?.statuses ?? []).map((s) => (
														<SelectItem key={s} value={s}>{s}</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
				</TabsContent>
				<TabsContent value="leaves" className="mt-4">
					<LeavesTab />
				</TabsContent>
				<TabsContent value="advances" className="mt-4">
					<AdvancesTab />
				</TabsContent>
				<TabsContent value="structures" className="mt-4">
					<StructuresTab />
				</TabsContent>
				<TabsContent value="payroll" className="mt-4">
					<PayrollTab />
				</TabsContent>
			</Tabs>
		</main>
	);
}
