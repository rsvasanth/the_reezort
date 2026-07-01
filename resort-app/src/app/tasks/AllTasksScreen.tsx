/**
 * AllTasksScreen — manager view of every housekeeping/maintenance task across
 * the property. Filter by status / type / assignee / days back.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Field } from "@/components/workspace/field";
import { KpiStrip, WorkspacePage } from "@/components/workspace/workspace";

import {
	listHousekeepers,
	listTasks,
	type HousekeeperOption,
	type TaskRow,
} from "@/lib/housekeeping-api";

const STATUS_FILTERS = ["All", "Open", "Queued", "Assigned", "In Progress", "Paused", "Inspection Required", "Completed", "Cancelled"];
const TYPE_FILTERS = ["All", "Departure Cleaning", "Stayover Cleaning", "Arrival Touch-up", "Turndown", "Deep Cleaning", "Amenity Replenishment", "Minibar Check", "Linen Change", "Room Inspection", "Public Area Cleaning", "Guest Request Support", "Maintenance Follow-up"];
const DAY_WINDOWS = [3, 7, 14, 30, 90];

function fmt(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function duration(a: string | null, b: string | null): string {
	if (!a || !b) return "—";
	const s = new Date(a.replace(" ", "T")).getTime();
	const e = new Date(b.replace(" ", "T")).getTime();
	if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
	const m = Math.round((e - s) / 60000);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	const r = m % 60;
	return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
	Queued: "outline",
	Assigned: "secondary",
	"In Progress": "default",
	Paused: "secondary",
	"Inspection Required": "outline",
	Completed: "secondary",
	Cancelled: "destructive",
	Skipped: "outline",
};

export default function AllTasksScreen() {
	const [tasks, setTasks] = useState<TaskRow[]>([]);
	const [staff, setStaff] = useState<HousekeeperOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [status, setStatus] = useState("All");
	const [type, setType] = useState("All");
	const [assignee, setAssignee] = useState<string>("All");
	const [days, setDays] = useState(14);
	const [query, setQuery] = useState("");

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const statusArg =
				status === "All" ? undefined :
				status === "Open" ? "Queued,Assigned,In Progress,Paused,Inspection Required" :
				status;
			const env = await listTasks({
				status: statusArg,
				task_type: type === "All" ? undefined : type,
				assigned_user: assignee === "All" ? undefined : assignee,
				days,
			});
			setTasks(env.data?.tasks ?? []);
		} catch (err) {
			toast.error("Could not load tasks", { description: err instanceof Error ? err.message : undefined });
		} finally {
			setLoading(false);
		}
	}, [status, type, assignee, days]);

	useEffect(() => {
		listHousekeepers().then((e) => setStaff(e.data?.staff ?? [])).catch(() => setStaff([]));
	}, []);
	useEffect(() => { void reload(); }, [reload]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return tasks;
		return tasks.filter((t) => {
			return [t.room_name, t.room_number, t.room, t.task_type, t.assignee_name, t.assigned_user]
				.filter(Boolean)
				.some((v) => String(v).toLowerCase().includes(q));
		});
	}, [tasks, query]);

	const kpis = useMemo(() => {
		const c: Record<string, number> = {};
		for (const t of filtered) c[t.task_status] = (c[t.task_status] ?? 0) + 1;
		return c;
	}, [filtered]);

	return (
		<WorkspacePage
			badge="All tasks"
			title="Task ledger"
			subtitle="Every housekeeping and maintenance task across the property."
			testId="all-tasks-screen"
			actions={<Button size="sm" variant="outline" onClick={reload} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>}
		>
			<KpiStrip items={[
				{ label: "Open", value: (kpis.Queued ?? 0) + (kpis.Assigned ?? 0) + (kpis["In Progress"] ?? 0) + (kpis.Paused ?? 0) + (kpis["Inspection Required"] ?? 0) },
				{ label: "In Progress", value: kpis["In Progress"] ?? 0, accent: (kpis["In Progress"] ?? 0) > 0 ? "good" : undefined },
				{ label: "Completed", value: kpis.Completed ?? 0, accent: "good" },
				{ label: "Cancelled", value: kpis.Cancelled ?? 0 },
				{ label: "Total", value: filtered.length },
			]} />

			<Card>
				<CardContent className="grid gap-3 py-4 md:grid-cols-6">
					<Field label="Status">
						<Select value={status} onValueChange={setStatus}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>{STATUS_FILTERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
						</Select>
					</Field>
					<Field label="Type">
						<Select value={type} onValueChange={setType}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>{TYPE_FILTERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
						</Select>
					</Field>
					<Field label="Assignee">
						<Select value={assignee} onValueChange={setAssignee}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="All">All</SelectItem>
								{staff.map((s) => <SelectItem key={s.name} value={s.name}>{s.full_name}</SelectItem>)}
							</SelectContent>
						</Select>
					</Field>
					<Field label="Window (days)">
						<Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>{DAY_WINDOWS.map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}</SelectContent>
						</Select>
					</Field>
					<Field label="Search">
						<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Room, type, assignee…" />
					</Field>
				</CardContent>
			</Card>

			{loading ? (
				<div className="flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
			) : filtered.length === 0 ? (
				<Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No tasks match these filters.</CardContent></Card>
			) : (
				<Card>
					<CardContent className="p-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Room</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Assignee</TableHead>
									<TableHead>Started</TableHead>
									<TableHead>Finished</TableHead>
									<TableHead>Duration</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filtered.map((t) => (
									<TableRow key={t.name}>
										<TableCell className="font-medium">
											{t.room_name ?? t.room_number ?? "—"}
											{t.room_number && t.room_name ? <span className="ml-2 text-xs text-muted-foreground">{t.room_number}</span> : null}
										</TableCell>
										<TableCell className="text-sm">{t.task_type}</TableCell>
										<TableCell><Badge variant={STATUS_VARIANT[t.task_status] ?? "outline"}>{t.task_status}</Badge></TableCell>
										<TableCell className="text-sm">{t.assignee_name ?? t.assigned_user ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
										<TableCell className="text-sm">{fmt(t.start_time)}</TableCell>
										<TableCell className="text-sm">{fmt(t.completed_at)}</TableCell>
										<TableCell className="text-sm tabular-nums">{duration(t.start_time, t.completed_at)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}
		</WorkspacePage>
	);
}
