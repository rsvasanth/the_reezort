/**
 * EngineeringBoard — #/maintenance/engineering (spec 009).
 *
 * Two-tab view:
 *   · Downtimes — active room downtime list with Request Release / Verify & Release actions
 *   · Preventive — PM plans + upcoming tasks
 *
 * Driven by get_engineering_board + get_room_downtime_board + list_preventive_plans/tasks.
 * Live-with-mock fallback on network failure.
 */

import { useCallback, useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace";
import { useFrappeAuth } from "frappe-react-sdk";
import { motion } from "motion/react";
import {
	AlertTriangle,
	CalendarClock,
	CheckCircle2,
	ClipboardList,
	Loader2,
	RefreshCw,
	Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EASE_OUT } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import { getPrimaryResortProperty } from "@/lib/maintenance-api";
import {
	MOCK_DOWNTIMES,
	getRoomDowntimeBoard,
	requestRoomRelease,
	verifyAndReleaseRoom,
	type RoomDowntime,
	type DowntimeBoardResult,
} from "@/lib/downtime-api";
import {
	MOCK_PLANS,
	MOCK_TASKS,
	listPreventivePlans,
	listPreventiveTasks,
	type PreventivePlan,
	type PreventiveTask,
} from "@/lib/preventive-api";
import { relativeTime, shortRoom } from "./maintenance-format";

type LoadState = "loading" | "live" | "mock";

// ---------- helpers ----------

function formatDatetime(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", {
		day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
	}).format(d);
}

function downtimeStatusTone(s: string): string {
	switch (s) {
		case "Active": return "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300";
		case "Extended": return "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-300";
		case "Pending Release": return "border-transparent bg-sky-500/15 text-sky-600 dark:text-sky-300";
		case "Released": return "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
		case "Cancelled": return "border text-muted-foreground";
		default: return "border text-muted-foreground";
	}
}

function impactTone(c: string): string {
	switch (c) {
		case "Critical": return "border-transparent bg-destructive text-destructive-foreground";
		case "High": return "border-transparent bg-amber-500 text-black";
		case "Medium": return "border-transparent bg-secondary text-secondary-foreground";
		default: return "border text-muted-foreground";
	}
}

function pmStatusTone(s: string): string {
	switch (s) {
		case "Completed": return "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
		case "In Progress": return "border-transparent bg-brass/15 text-brass";
		case "Generated": return "border-transparent bg-sky-500/15 text-sky-600 dark:text-sky-300";
		case "Missed": return "border-transparent bg-destructive/15 text-destructive";
		case "Cancelled": return "border text-muted-foreground";
		default: return "border text-muted-foreground";
	}
}

// ---------- main component ----------

export default function EngineeringBoard() {
	const { currentUser } = useFrappeAuth();
	const [property, setProperty] = useState<string | null>(null);
	const [downtimes, setDowntimes] = useState<RoomDowntime[]>([]);
	const [plans, setPlans] = useState<PreventivePlan[]>([]);
	const [tasks, setTasks] = useState<PreventiveTask[]>([]);
	const [downtimeState, setDowntimeState] = useState<LoadState>("loading");
	const [pmState, setPmState] = useState<LoadState>("loading");
	const [busyRow, setBusyRow] = useState<string | null>(null);

	useEffect(() => {
		getPrimaryResortProperty().then((p) => setProperty(p));
	}, []);

	const loadDowntimes = useCallback(
		async (quiet = false) => {
			if (!property) return;
			if (!quiet) setDowntimeState("loading");
			try {
				const res: DowntimeBoardResult = await getRoomDowntimeBoard(property, {
					downtime_status: "Active,Extended,Pending Release",
				});
				setDowntimes(res.downtimes);
				setDowntimeState("live");
			} catch (error) {
				if (error instanceof FolioApiError) {
					toast.error("Could not load downtimes", { description: error.blockers[0]?.message ?? error.message });
					setDowntimes([]);
					setDowntimeState("live");
					return;
				}
				setDowntimes(MOCK_DOWNTIMES);
				setDowntimeState("mock");
			}
		},
		[property],
	);

	const loadPm = useCallback(
		async (quiet = false) => {
			if (!property) return;
			if (!quiet) setPmState("loading");
			try {
				const [plansRes, tasksRes] = await Promise.all([
					listPreventivePlans(property),
					listPreventiveTasks(property),
				]);
				setPlans(plansRes.plans);
				setTasks(tasksRes.tasks);
				setPmState("live");
			} catch {
				setPlans(MOCK_PLANS);
				setTasks(MOCK_TASKS);
				setPmState("mock");
			}
		},
		[property],
	);

	useEffect(() => {
		if (property) {
			void loadDowntimes();
			void loadPm();
		}
	}, [property, loadDowntimes, loadPm]);

	async function act(fn: () => Promise<unknown>, key: string) {
		if (busyRow) return;
		setBusyRow(key);
		try {
			await fn();
			void loadDowntimes(true);
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Action failed", { description: msg });
		} finally {
			setBusyRow(null);
		}
	}

	function handleRequestRelease(dt: RoomDowntime) {
		const notes = window.prompt("Notes for release request (optional):") ?? undefined;
		void act(
			() => requestRoomRelease(dt.name, notes).then(() => toast.success("Release requested")),
			dt.name,
		);
	}

	function handleVerifyRelease(dt: RoomDowntime) {
		if (!currentUser) return;
		if (!window.confirm(`Verify and release room ${shortRoom(dt.room)}? This restores its sellable status.`)) return;
		void act(
			() =>
				verifyAndReleaseRoom(dt.name, {
					verification_status: "Passed",
					verified_by: currentUser,
					notes: "",
				}).then((r) => {
					if (r.released) toast.success("Room released");
					else toast.error("Release blocked", { description: r.blockers?.join(", ") });
				}),
			dt.name,
		);
	}

	const activeCount = downtimes.filter((d) =>
		["Active", "Extended", "Pending Release"].includes(d.downtime_status),
	).length;

	const pendingCount = downtimes.filter((d) => d.downtime_status === "Pending Release").length;

	return (
		<WorkspacePage title="Engineering" subtitle="Work orders, assets and downtime.">
			{/* Header */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<Badge variant="outline">{downtimeState === "live" ? "Live" : downtimeState === "loading" ? "Loading" : "Mock"}</Badge>
						<Badge variant="secondary">Engineering</Badge>
					</div>
					<h1 className="font-display text-3xl font-light tracking-tight">Engineering Board</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{activeCount} active downtime{activeCount !== 1 ? "s" : ""}
						{pendingCount > 0 ? ` · ${pendingCount} pending release` : ""}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon"
						aria-label="Refresh"
						onClick={() => { void loadDowntimes(); void loadPm(); }}
					>
						<RefreshCw className="size-4" />
					</Button>
				</div>
			</div>

			<Tabs defaultValue="downtimes">
				<TabsList>
					<TabsTrigger value="downtimes" className="gap-1.5">
						<Wrench className="size-3.5" /> Downtimes
						{activeCount > 0 ? (
							<span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
								{activeCount}
							</span>
						) : null}
					</TabsTrigger>
					<TabsTrigger value="preventive" className="gap-1.5">
						<CalendarClock className="size-3.5" /> Preventive
					</TabsTrigger>
				</TabsList>

				{/* ── Downtimes tab ── */}
				<TabsContent value="downtimes" className="mt-4">
					{downtimeState === "loading" ? (
						<div className="flex flex-col gap-3">
							{Array.from({ length: 3 }).map((_, i) => (
								<Skeleton key={i} className="h-24 w-full rounded-xl" />
							))}
						</div>
					) : downtimes.length === 0 ? (
						<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
							<CheckCircle2 className="size-7 text-muted-foreground/50" />
							<p className="text-sm text-muted-foreground">No active room downtimes — all rooms operational.</p>
						</div>
					) : (
						<div className="flex flex-col gap-3">
							{downtimes.map((dt, i) => (
								<motion.div
									key={dt.name}
									initial={{ opacity: 0, y: 8 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.25, ease: EASE_OUT, delay: Math.min(i * 0.04, 0.3) }}
								>
									<DowntimeRow
										downtime={dt}
										busy={busyRow === dt.name}
										onRequestRelease={() => handleRequestRelease(dt)}
										onVerifyRelease={() => handleVerifyRelease(dt)}
									/>
								</motion.div>
							))}
						</div>
					)}
				</TabsContent>

				{/* ── Preventive tab ── */}
				<TabsContent value="preventive" className="mt-4 flex flex-col gap-6">
					<PmPlansSection plans={plans} loading={pmState === "loading"} />
					<PmTasksSection tasks={tasks} loading={pmState === "loading"} />
				</TabsContent>
			</Tabs>
		</WorkspacePage>
	);
}

// ---------- sub-components ----------

function DowntimeRow({
	downtime: dt,
	busy,
	onRequestRelease,
	onVerifyRelease,
}: {
	downtime: RoomDowntime;
	busy: boolean;
	onRequestRelease: () => void;
	onVerifyRelease: () => void;
}) {
	const isPendingRelease = dt.downtime_status === "Pending Release";
	const isActive = ["Active", "Extended"].includes(dt.downtime_status);
	const overExpected =
		dt.expected_release_at
			? new Date(dt.expected_release_at.replace(" ", "T")).getTime() < Date.now()
			: false;

	return (
		<div
			className={`rounded-xl border bg-card p-4 transition-colors ${overExpected && isActive ? "border-amber-500/40 bg-amber-500/5" : ""}`}
			data-testid={`downtime-${dt.name}`}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<a
							href={`#/room/${encodeURIComponent(dt.room)}`}
							className="font-mono text-sm font-semibold hover:underline"
						>
							{shortRoom(dt.room)}
						</a>
						<Badge variant="outline" className={`text-[10px] ${downtimeStatusTone(dt.downtime_status)}`}>
							{dt.downtime_status}
						</Badge>
						<Badge variant="outline" className="text-[10px]">{dt.downtime_type}</Badge>
						{dt.revenue_impact_class !== "None" ? (
							<Badge variant="outline" className={`text-[10px] ${impactTone(dt.revenue_impact_class)}`}>
								{dt.revenue_impact_class} impact
							</Badge>
						) : null}
						{overExpected && isActive ? (
							<Badge variant="outline" className="gap-1 border-transparent bg-amber-500 text-[10px] text-black">
								<AlertTriangle className="size-3" /> Overdue release
							</Badge>
						) : null}
					</div>

					<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
						<span>{dt.reason}</span>
						<span>· Started {relativeTime(dt.start_at)}</span>
						<span>· Expected {formatDatetime(dt.expected_release_at)}</span>
						{dt.extension_count > 0 ? <span>· Extended {dt.extension_count}×</span> : null}
						<span>· Ticket <a href={`#/maintenance?ticket=${encodeURIComponent(dt.maintenance_ticket)}`} className="hover:underline">{dt.maintenance_ticket}</a></span>
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-1.5">
					{isActive ? (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={onRequestRelease}
							data-testid={`request-release-${dt.name}`}
						>
							{busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
							Request release
						</Button>
					) : null}
					{isPendingRelease ? (
						<Button
							size="sm"
							disabled={busy}
							onClick={onVerifyRelease}
							data-testid={`verify-release-${dt.name}`}
						>
							{busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
							Verify &amp; release
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}

function PmPlansSection({ plans, loading }: { plans: PreventivePlan[]; loading: boolean }) {
	return (
		<section>
			<h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
				Maintenance Plans
			</h2>
			{loading ? (
				<div className="flex flex-col gap-2">
					{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
				</div>
			) : plans.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
					<ClipboardList className="size-6 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">No preventive maintenance plans configured.</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{plans.map((plan) => (
						<div key={plan.name} className="rounded-xl border bg-card p-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium">{plan.plan_name}</span>
										{!plan.active ? (
											<Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>
										) : null}
									</div>
									<div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
										<span>{plan.plan_scope}</span>
										<span>· {plan.recurrence_type}</span>
										{plan.responsible_team ? <span>· {plan.responsible_team}</span> : null}
										{plan.expected_minutes ? <span>· ~{plan.expected_minutes} min</span> : null}
									</div>
								</div>
								<div className="text-right text-[11px] text-muted-foreground">
									<div>Next due</div>
									<div className="font-medium text-foreground">{plan.next_due_date}</div>
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

function PmTasksSection({ tasks, loading }: { tasks: PreventiveTask[]; loading: boolean }) {
	const upcoming = tasks.filter((t) => !["Completed", "Cancelled"].includes(t.task_status));
	return (
		<section>
			<h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
				Upcoming Tasks
			</h2>
			{loading ? (
				<div className="flex flex-col gap-2">
					{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
				</div>
			) : upcoming.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
					<CalendarClock className="size-6 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">No upcoming PM tasks in the queue.</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{upcoming.map((task) => (
						<div key={task.name} className="rounded-xl border bg-card p-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<span className="font-mono text-xs text-muted-foreground">{task.name}</span>
									<Badge variant="outline" className={`text-[10px] ${pmStatusTone(task.task_status)}`}>
										{task.task_status}
									</Badge>
									{task.maintenance_ticket ? (
										<a
											href={`#/maintenance?ticket=${encodeURIComponent(task.maintenance_ticket)}`}
											className="text-xs hover:underline text-sky-600 dark:text-sky-300"
										>
											{task.maintenance_ticket}
										</a>
									) : null}
								</div>
								<div className="text-[11px] text-muted-foreground">
									Due <span className="font-medium text-foreground">{task.due_date}</span>
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
