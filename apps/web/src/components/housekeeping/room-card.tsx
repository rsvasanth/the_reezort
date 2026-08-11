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
	Ban,
	CheckCircle,
	ClipboardCheck,
	Pause,
	Play,
	RefreshCw,
	Shirt,
	UserPlus,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CompleteTaskSheet } from "@/components/housekeeping/complete-task-sheet";
import { InspectionSheet } from "@/components/housekeeping/inspection-sheet";
import { LinenSheet } from "@/components/housekeeping/linen-sheet";
import { RoomThumb } from "@/components/property/room-thumb";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import {
	assignTask,
	createTask,
	listHousekeepers,
	markDndOrRefused,
	pauseTask,
	startTask,
	FolioApiError,
} from "@/lib/housekeeping-api";
import type { HousekeeperOption, HousekeepingRoom } from "@/lib/housekeeping-api";

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
	const [linenOpen, setLinenOpen] = useState(false);
	const [completeOpen, setCompleteOpen] = useState(false);
	const [inspectOpen, setInspectOpen] = useState(false);

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

	async function handleCreateTask() {
		// No task yet — open a Departure Cleaning task (the turnover default for a
		// vacant dirty room). requires_inspection keeps it on the board through the
		// inspection step. Fresh idempotency key per click; the busy-guard and the
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
	}

	async function handleStart() {
		if (!task) return;
		await runMutation("Start task", () => startTask(task.id), "Task started");
	}

	async function handlePause() {
		if (!task) return;
		await runMutation("Pause task", () => pauseTask(task.id), "Task paused");
	}

	async function handleDnd(status: "DND" | "Refused" | "Access Issue") {
		if (!task) return;
		await runMutation(`Mark ${status}`, () => markDndOrRefused(task.id, status), `${status} recorded`);
	}

	// Complete and Inspect open sheets that collect notes + room photos
	// (CompleteTaskSheet / InspectionSheet) instead of firing one-click calls.

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
				{/* Header: thumbnail + room number + housekeeping status */}
				<div className="flex items-start justify-between gap-2">
					<div className="flex items-center gap-2">
						<RoomThumb image={room.image} label={room.room_number} size={40} />
						<div>
							<span className="text-lg font-semibold leading-none">{room.room_number}</span>
							<p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
								{room.room_name}
							</p>
						</div>
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
					{room.maintenance_status !== "Available" && (
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
								className="h-10 text-xs md:h-7"
								disabled={busy}
								onClick={handleCreateTask}
							>
								{busy ? (
									<RefreshCw className="mr-1 size-3 animate-spin" />
								) : (
									<UserPlus className="mr-1 size-3" />
								)}
								Create Task
							</Button>
						)}
						{!isMock && (
							<Button
								size="sm"
								variant="outline"
								className="h-10 text-xs md:h-7"
								onClick={() => setLinenOpen(true)}
								data-testid={`linen-${room.room_number}`}
							>
								<Shirt className="mr-1 size-3" />
								Linen
							</Button>
						)}
						{showAssign && task && (
							<AssignMenu
								taskId={task.id}
								roomNumber={room.room_number}
								busy={busy}
								onAssigned={onMutated}
								setBusy={setBusy}
							/>
						)}
						{showStart && (
							<Button
								size="sm"
								className="h-10 text-xs md:h-7"
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
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										size="sm"
										variant="outline"
										className="h-10 text-xs md:h-7"
										disabled={busy}
										data-testid={`dnd-${room.room_number}`}
									>
										<Ban className="mr-1 size-3" />
										DND
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start">
									<DropdownMenuItem onClick={() => handleDnd("DND")}>Do Not Disturb</DropdownMenuItem>
									<DropdownMenuItem onClick={() => handleDnd("Refused")}>Entry refused</DropdownMenuItem>
									<DropdownMenuItem onClick={() => handleDnd("Access Issue")}>Access issue</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
						{showPause && (
							<Button
								size="sm"
								variant="outline"
								className="h-10 text-xs md:h-7"
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
								className="h-10 text-xs md:h-7"
								disabled={busy}
								onClick={() => setCompleteOpen(true)}
							>
								<CheckCircle className="mr-1 size-3" />
								Complete
							</Button>
						)}
						{showInspect && (
							<Button
								size="sm"
								variant="outline"
								className="h-10 text-xs md:h-7"
								disabled={busy}
								onClick={() => setInspectOpen(true)}
							>
								<ClipboardCheck className="mr-1 size-3" />
								Inspect
							</Button>
						)}
					</div>
				)}
			</CardContent>
			<LinenSheet
				open={linenOpen}
				onOpenChange={setLinenOpen}
				room={room.name}
				roomLabel={room.room_number}
				defaultPhase="Departure"
				onPosted={onMutated}
			/>
			{task ? (
				<>
					<CompleteTaskSheet
						open={completeOpen}
						onOpenChange={setCompleteOpen}
						task={task.id}
						roomLabel={room.room_number}
						onCompleted={onMutated}
					/>
					<InspectionSheet
						open={inspectOpen}
						onOpenChange={setInspectOpen}
						task={task.id}
						roomLabel={room.room_number}
						onRecorded={onMutated}
					/>
				</>
			) : null}
		</Card>
	);
}

// ---------- Assign-to picker ----------

function AssignMenu({
	taskId,
	roomNumber,
	busy,
	setBusy,
	onAssigned,
}: {
	taskId: string;
	roomNumber: string;
	busy: boolean;
	setBusy: (b: boolean) => void;
	onAssigned: () => void;
}) {
	const [staff, setStaff] = useState<HousekeeperOption[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	async function loadStaffOnce() {
		if (staff !== null) return;
		try {
			const env = await listHousekeepers();
			setStaff(env.data?.staff ?? []);
			setLoadError(null);
		} catch (err) {
			setStaff([]);
			setLoadError(err instanceof Error ? err.message : "Could not load staff");
		}
	}

	async function assignTo(userId: string | null, displayName: string) {
		setBusy(true);
		try {
			await assignTask(taskId, userId, null);
			toast.success(userId ? `Assigned to ${displayName}` : "Assigned (unpicked)", {
				description: `Room ${roomNumber}`,
			});
			onAssigned();
		} catch (err) {
			const msg = err instanceof FolioApiError && err.blockers.length > 0
				? err.blockers.map((b) => b.message).join("; ")
				: err instanceof Error
					? err.message
					: "Assign failed";
			toast.error("Assign failed", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	return (
		<DropdownMenu onOpenChange={(open) => { if (open) void loadStaffOnce(); }}>
			<DropdownMenuTrigger asChild>
				<Button size="sm" variant="outline" className="h-10 text-xs md:h-7" disabled={busy} data-testid={`assign-${taskId}`}>
					{busy ? <RefreshCw className="mr-1 size-3 animate-spin" /> : <UserPlus className="mr-1 size-3" />}
					Assign
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64" avoidClipping>
				<DropdownMenuLabel>Assign to</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{staff === null ? (
					<DropdownMenuItem disabled>Loading…</DropdownMenuItem>
				) : loadError ? (
					<DropdownMenuItem disabled>Could not load: {loadError}</DropdownMenuItem>
				) : staff.length === 0 ? (
					<DropdownMenuItem disabled>No housekeeping/maintenance staff</DropdownMenuItem>
				) : (
					staff.map((s) => (
						<DropdownMenuItem
							key={s.name}
							onClick={() => void assignTo(s.name, s.full_name)}
							data-testid={`assign-to-${s.name}`}
						>
							<div className="flex w-full items-center justify-between gap-2">
								<span className="truncate">{s.full_name}</span>
								<span className="ml-2 shrink-0 text-xs text-muted-foreground">
									{s.roles[0] ?? ""}
								</span>
							</div>
						</DropdownMenuItem>
					))
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => void assignTo(null, "unassigned")}>
					<span className="text-muted-foreground">Assigned — pick later</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
