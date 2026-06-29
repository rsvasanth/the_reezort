/**
 * RoomCard — renders a single room tile in the housekeeping board.
 *
 * Action buttons are determined by the open_task.status state machine
 * (statuses mirror the Housekeeping Task doctype):
 *   (no task)             → [Create Task]
 *   Queued                → [Assign]
 *   Assigned / Paused     → [Start]
 *   In Progress           → [Pause] [Complete]
 *   Inspection Required   → [Inspect]
 *   Completed             → leaves the board (room clean/inspected)
 *
 * In mock mode (isMock=true) all action buttons are hidden.
 */

import { useState } from "react";
import { toast } from "sonner";
import {
	CheckCircle,
	ClipboardCheck,
	Pause,
	Play,
	RefreshCw,
	UserPlus,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import {
	assignTask,
	completeTask,
	createInspection,
	createTask,
	pauseTask,
	recordInspection,
	startTask,
	FolioApiError,
} from "@/lib/housekeeping-api";
import type { HousekeepingRoom, InspectionOutcome } from "@/lib/housekeeping-api";

import {
	formatDueAt,
	getInitials,
	housekeepingStatusBadge,
	housekeepingStatusTooltip,
	maintenanceStatusBadge,
	occupancyStatusBadge,
	occupancyStatusTooltip,
	taskStatusBadge,
	priorityBadge,
} from "./housekeeping-format";

type Props = {
	room: HousekeepingRoom;
	isMock: boolean;
	onMutated: () => void;
};

export function RoomCard({ room, isMock, onMutated }: Props) {
	const [busy, setBusy] = useState(false);

	const hkStyle = housekeepingStatusBadge(room.housekeeping_status);
	const occStyle = occupancyStatusBadge(room.occupancy_status);
	const maintStyle = maintenanceStatusBadge(room.maintenance_status);
	const task = room.open_task;

	async function runMutation<T>(
		label: string,
		fn: () => Promise<T>,
		successMsg: string
	): Promise<void> {
		setBusy(true);
		try {
			await fn();
			toast.success(successMsg, { description: `Room ${room.room_number}` });
			onMutated();
		} catch (err) {
			const msg =
				err instanceof FolioApiError && err.blockers.length > 0
					? err.blockers.map((b) => b.message).join("; ")
					: err instanceof Error
						? err.message
						: `${label} failed`;
			toast.error(`${label} failed`, { description: msg });
		} finally {
			setBusy(false);
		}
	}

	async function handleAssign() {
		if (!task) {
			// No task yet — open a Departure Cleaning task (the turnover default for a
			// vacant dirty room). requires_inspection keeps it on the board through the
			// inspection step. A fresh idempotency key per click; the busy-guard and the
			// hidden-when-open button prevent duplicate creates.
			await runMutation("Create task", () =>
				createTask({
					room: room.name,
					task_type: "Departure Cleaning",
					idempotency_key: crypto.randomUUID(),
					requires_inspection: true,
				}),
				"Task created"
			);
			return;
		}
		// Assign the existing open task to a placeholder (null — supervisor picks later)
		await runMutation("Assign task", () =>
			assignTask(task.id, null, null),
			"Task assigned"
		);
	}

	async function handleStart() {
		if (!task) return;
		await runMutation("Start task", () => startTask(task.id), "Task started");
	}

	async function handlePause() {
		if (!task) return;
		await runMutation("Pause task", () => pauseTask(task.id), "Task paused");
	}

	async function handleComplete() {
		if (!task) return;
		await runMutation("Complete task", () => completeTask(task.id, null), "Task completed");
	}

	async function handleInspect() {
		if (!task) return;
		setBusy(true);
		try {
			// Create inspection then immediately record as Passed (default happy path;
			// a future InspectionSheet can collect outcome/notes properly).
			const envelope = await createInspection(task.id);
			if (!envelope.ok || !envelope.data) {
				throw new Error("Create inspection returned no data");
			}
			const inspectionId = envelope.data.inspection;
			const outcome: InspectionOutcome = "Passed";
			await recordInspection(inspectionId, outcome, null, null);
			toast.success("Inspection recorded — Passed", { description: `Room ${room.room_number}` });
			onMutated();
		} catch (err) {
			const msg =
				err instanceof FolioApiError && err.blockers.length > 0
					? err.blockers.map((b) => b.message).join("; ")
					: err instanceof Error
						? err.message
						: "Inspect failed";
			toast.error("Inspect failed", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	const taskStatusStyle = task ? taskStatusBadge(task.status) : null;
	const priorityStyle = task ? priorityBadge(task.priority) : null;
	const dueAt = task?.due_at ? formatDueAt(task.due_at) : null;

	// Derive valid next actions from task status
	const showCreate = !isMock && !task;
	const showAssign = !isMock && task?.status === "Queued";
	const showStart = !isMock && (task?.status === "Assigned" || task?.status === "Paused");
	const showPause = !isMock && task?.status === "In Progress";
	const showComplete = !isMock && task?.status === "In Progress";
	const showInspect =
		!isMock && (task?.status === "Inspection Required" || task?.status === "Completed");

	const hasActions = showCreate || showAssign || showStart || showPause || showComplete || showInspect;

	return (
		<Card className="flex flex-col gap-0 overflow-hidden" data-testid={`room-${room.room_number}`}>
			<CardContent className="flex flex-col gap-3 p-4">
				{/* Header: room number + housekeeping status */}
				<div className="flex items-start justify-between gap-2">
					<div>
						<span className="text-lg font-semibold leading-none">{room.room_number}</span>
						<p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
							{room.room_name}
						</p>
					</div>
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge
									variant={hkStyle.variant}
									className={hkStyle.className}
								>
									{room.housekeeping_status}
								</Badge>
							</TooltipTrigger>
							<TooltipContent side="left">
								{housekeepingStatusTooltip(room.housekeeping_status)}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</div>

				{/* Occupancy + maintenance badges */}
				<div className="flex flex-wrap gap-1.5">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge variant={occStyle.variant} className={`text-xs ${occStyle.className ?? ""}`}>
									{room.occupancy_status}
								</Badge>
							</TooltipTrigger>
							<TooltipContent>{occupancyStatusTooltip(room.occupancy_status)}</TooltipContent>
						</Tooltip>
					</TooltipProvider>
					{room.maintenance_status !== "None" && (
						<Badge
							variant={maintStyle.variant}
							className={`text-xs ${maintStyle.className ?? ""}`}
						>
							{room.maintenance_status}
						</Badge>
					)}
				</div>

				{/* Open task block */}
				{task ? (
					<div className="rounded-md border bg-muted/30 p-2.5 text-xs">
						<div className="flex items-center justify-between gap-2">
							<span className="font-medium">{task.type}</span>
							{taskStatusStyle && (
								<Badge
									variant={taskStatusStyle.variant}
									className={`text-[10px] ${taskStatusStyle.className ?? ""}`}
								>
									{task.status}
								</Badge>
							)}
						</div>
						<div className="mt-1.5 flex items-center gap-2">
							{/* Assignee avatar */}
							<Avatar className="size-5">
								<AvatarFallback className="text-[9px]">
									{getInitials(task.assignee)}
								</AvatarFallback>
							</Avatar>
							<span className="truncate text-muted-foreground">
								{task.assignee ?? "Unassigned"}
							</span>
							{priorityStyle && (
								<Badge
									variant={priorityStyle.variant}
									className={`ml-auto text-[10px] ${priorityStyle.className ?? ""}`}
								>
									{task.priority}
								</Badge>
							)}
							{dueAt && (
								<span className="shrink-0 text-muted-foreground">by {dueAt}</span>
							)}
						</div>
					</div>
				) : (
					<p className="text-xs text-muted-foreground">No open task</p>
				)}

				{/* Action buttons */}
				{hasActions && (
					<div className="flex flex-wrap gap-1.5 pt-0.5">
						{showCreate && (
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								disabled={busy}
								onClick={handleAssign}
							>
								{busy ? (
									<RefreshCw className="mr-1 size-3 animate-spin" />
								) : (
									<UserPlus className="mr-1 size-3" />
								)}
								Create Task
							</Button>
						)}
						{showAssign && (
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								disabled={busy}
								onClick={handleAssign}
							>
								{busy ? (
									<RefreshCw className="mr-1 size-3 animate-spin" />
								) : (
									<UserPlus className="mr-1 size-3" />
								)}
								Assign
							</Button>
						)}
						{showStart && (
							<Button
								size="sm"
								className="h-7 text-xs"
								disabled={busy}
								onClick={handleStart}
							>
								{busy ? (
									<RefreshCw className="mr-1 size-3 animate-spin" />
								) : (
									<Play className="mr-1 size-3" />
								)}
								{task?.status === "Paused" ? "Resume" : "Start"}
							</Button>
						)}
						{showPause && (
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								disabled={busy}
								onClick={handlePause}
							>
								{busy ? (
									<RefreshCw className="mr-1 size-3 animate-spin" />
								) : (
									<Pause className="mr-1 size-3" />
								)}
								Pause
							</Button>
						)}
						{showComplete && (
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								disabled={busy}
								onClick={handleComplete}
							>
								{busy ? (
									<RefreshCw className="mr-1 size-3 animate-spin" />
								) : (
									<CheckCircle className="mr-1 size-3" />
								)}
								Complete
							</Button>
						)}
						{showInspect && (
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								disabled={busy}
								onClick={handleInspect}
							>
								{busy ? (
									<RefreshCw className="mr-1 size-3 animate-spin" />
								) : (
									<ClipboardCheck className="mr-1 size-3" />
								)}
								Inspect
							</Button>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
