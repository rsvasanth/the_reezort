/**
 * MyTasksScreen — the current staff user's queue.
 *   Open tab   → open tasks (with Start / Pause / Complete / Inspect actions)
 *   History    → last N closed tasks with real start/end timestamps + duration
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
	CheckCircle2,
	ClipboardCheck,
	Loader2,
	Pause,
	Play,
	RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiStrip, WorkspacePage } from "@/components/workspace/workspace";
import { CompleteTaskSheet } from "@/components/housekeeping/complete-task-sheet";
import { InspectionSheet } from "@/components/housekeeping/inspection-sheet";

import {
	FolioApiError,
	listMyTasks,
	pauseTask,
	startTask,
	type TaskRow,
} from "@/lib/housekeeping-api";

type Scope = "open" | "history";

function formatDateTime(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function durationBetween(startIso: string | null, endIso: string | null): string {
	if (!startIso || !endIso) return "—";
	const start = new Date(startIso.replace(" ", "T")).getTime();
	const end = new Date(endIso.replace(" ", "T")).getTime();
	if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
	const mins = Math.round((end - start) / 60000);
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
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

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
	Low: "outline",
	Normal: "secondary",
	High: "destructive",
	Urgent: "destructive",
	VIP: "destructive",
};

export default function MyTasksScreen() {
	const [scope, setScope] = useState<Scope>("open");
	const [tasks, setTasks] = useState<TaskRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [busyTask, setBusyTask] = useState<string | null>(null);
	const [completeFor, setCompleteFor] = useState<TaskRow | null>(null);
	const [inspectFor, setInspectFor] = useState<TaskRow | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const env = await listMyTasks(scope);
			setTasks(env.data?.tasks ?? []);
		} catch (err) {
			toast.error("Could not load tasks", { description: err instanceof Error ? err.message : undefined });
		} finally {
			setLoading(false);
		}
	}, [scope]);

	useEffect(() => { void reload(); }, [reload]);

	const kpis = useMemo(() => {
		const byStatus: Record<string, number> = {};
		for (const t of tasks) byStatus[t.task_status] = (byStatus[t.task_status] ?? 0) + 1;
		return byStatus;
	}, [tasks]);

	async function withBusy(taskId: string, label: string, fn: () => Promise<unknown>) {
		setBusyTask(taskId);
		try {
			await fn();
			toast.success(label);
			await reload();
		} catch (err) {
			const detail = err instanceof FolioApiError && err.blockers.length > 0
				? err.blockers.map((b) => b.message).join("; ")
				: err instanceof Error ? err.message : `${label} failed`;
			toast.error(`${label} failed`, { description: detail });
		} finally {
			setBusyTask(null);
		}
	}

	return (
		<WorkspacePage
			badge="My tasks"
			title="My tasks"
			subtitle="Tasks assigned to you — start, pause, complete, or inspect from here."
			testId="my-tasks-screen"
			actions={
				<Button size="sm" variant="outline" onClick={reload} disabled={loading}>
					{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
				</Button>
			}
		>
			{scope === "open" ? (
				<KpiStrip items={[
					{ label: "Queued", value: kpis.Queued ?? 0 },
					{ label: "Assigned", value: kpis.Assigned ?? 0 },
					{ label: "In Progress", value: kpis["In Progress"] ?? 0, accent: (kpis["In Progress"] ?? 0) > 0 ? "good" : undefined },
					{ label: "Paused", value: kpis.Paused ?? 0, accent: (kpis.Paused ?? 0) > 0 ? "warn" : undefined },
					{ label: "Inspection", value: kpis["Inspection Required"] ?? 0 },
				]} />
			) : (
				<KpiStrip items={[
					{ label: "Completed", value: kpis.Completed ?? 0, accent: "good" },
					{ label: "Cancelled", value: kpis.Cancelled ?? 0 },
					{ label: "Skipped", value: kpis.Skipped ?? 0 },
				]} />
			)}

			<Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
				<TabsList>
					<TabsTrigger value="open" data-testid="tab-open">Open</TabsTrigger>
					<TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
				</TabsList>

				<TabsContent value="open" className="mt-4">
					<TaskTable
						tasks={tasks}
						loading={loading}
						scope="open"
						busyTask={busyTask}
						onStart={(t) => withBusy(t.name, "Started", () => startTask(t.name))}
						onPause={(t) => withBusy(t.name, "Paused", () => pauseTask(t.name))}
						onComplete={(t) => setCompleteFor(t)}
						onInspect={(t) => setInspectFor(t)}
					/>
				</TabsContent>

				<TabsContent value="history" className="mt-4">
					<TaskTable tasks={tasks} loading={loading} scope="history" busyTask={null} />
				</TabsContent>
			</Tabs>

			{completeFor ? (
				<CompleteTaskSheet
					open
					onOpenChange={(open) => { if (!open) setCompleteFor(null); }}
					task={completeFor.name}
					roomLabel={completeFor.room_number ?? completeFor.room ?? "—"}
					onCompleted={() => { setCompleteFor(null); void reload(); }}
				/>
			) : null}
			{inspectFor ? (
				<InspectionSheet
					open
					onOpenChange={(open) => { if (!open) setInspectFor(null); }}
					task={inspectFor.name}
					roomLabel={inspectFor.room_number ?? inspectFor.room ?? "—"}
					onRecorded={() => { setInspectFor(null); void reload(); }}
				/>
			) : null}
		</WorkspacePage>
	);
}

function TaskTable({
	tasks,
	loading,
	scope,
	busyTask,
	onStart,
	onPause,
	onComplete,
	onInspect,
}: {
	tasks: TaskRow[];
	loading: boolean;
	scope: Scope;
	busyTask: string | null;
	onStart?: (t: TaskRow) => void;
	onPause?: (t: TaskRow) => void;
	onComplete?: (t: TaskRow) => void;
	onInspect?: (t: TaskRow) => void;
}) {
	if (loading) return <div className="flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>;
	if (tasks.length === 0) {
		return (
			<Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
				{scope === "open" ? "No open tasks assigned to you." : "No history yet."}
			</CardContent></Card>
		);
	}
	return (
		<Card>
			<CardContent className="p-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Room</TableHead>
							<TableHead>Type</TableHead>
							<TableHead>Priority</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>{scope === "open" ? "Due / Started" : "Started"}</TableHead>
							<TableHead>{scope === "open" ? "Actions" : "Finished"}</TableHead>
							{scope === "history" ? <TableHead>Duration</TableHead> : null}
						</TableRow>
					</TableHeader>
					<TableBody>
						{tasks.map((t) => (
							<TableRow key={t.name} data-testid={`task-${t.name}`}>
								<TableCell className="font-medium">
									{t.room_name ?? t.room_number ?? t.room ?? "—"}
									{t.room_number && t.room_name ? <span className="ml-2 text-xs text-muted-foreground">{t.room_number}</span> : null}
								</TableCell>
								<TableCell className="text-sm">{t.task_type}</TableCell>
								<TableCell><Badge variant={PRIORITY_VARIANT[t.priority] ?? "outline"}>{t.priority}</Badge></TableCell>
								<TableCell><Badge variant={STATUS_VARIANT[t.task_status] ?? "outline"}>{t.task_status}</Badge></TableCell>
								<TableCell className="text-sm">{scope === "open" ? (formatDateTime(t.start_time) !== "—" ? formatDateTime(t.start_time) : formatDateTime(t.due_at)) : formatDateTime(t.start_time)}</TableCell>
								{scope === "open" ? (
									<TableCell>
										<div className="flex justify-end gap-1">
											{(t.task_status === "Assigned" || t.task_status === "Paused") && (
												<Button size="sm" variant="outline" disabled={busyTask === t.name} onClick={() => onStart?.(t)}>
													{busyTask === t.name ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Start
												</Button>
											)}
											{t.task_status === "In Progress" && (
												<>
													<Button size="sm" variant="ghost" disabled={busyTask === t.name} onClick={() => onPause?.(t)}>
														<Pause className="size-3" /> Pause
													</Button>
													<Button size="sm" disabled={busyTask === t.name} onClick={() => onComplete?.(t)}>
														<CheckCircle2 className="size-3" /> Complete
													</Button>
												</>
											)}
											{t.task_status === "Inspection Required" && (
												<Button size="sm" disabled={busyTask === t.name} onClick={() => onInspect?.(t)}>
													<ClipboardCheck className="size-3" /> Inspect
												</Button>
											)}
										</div>
									</TableCell>
								) : (
									<>
										<TableCell className="text-sm">{formatDateTime(t.completed_at)}</TableCell>
										<TableCell className="text-sm tabular-nums">{durationBetween(t.start_time, t.completed_at)}</TableCell>
									</>
								)}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
