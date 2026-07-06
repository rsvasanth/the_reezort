/**
 * CompleteTaskSheet — attendant finishes a cleaning task.
 *
 * Collects completion notes + after-cleaning photos, then calls
 * complete_task. Photos are stored on the task (Room Condition Photo rows)
 * and surface later in the room-readiness gallery at check-in.
 */

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { PhotoAttachList } from "@/components/housekeeping/photo-attach-list";
import { completeTask, FolioApiError, type TaskPhoto } from "@/lib/housekeeping-api";

export function CompleteTaskSheet({
	open,
	onOpenChange,
	task,
	roomLabel,
	onCompleted,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	task: string;
	roomLabel: string;
	onCompleted: () => void;
}) {
	const [notes, setNotes] = useState("");
	const [photos, setPhotos] = useState<TaskPhoto[]>([]);
	const [busy, setBusy] = useState(false);

	async function submit() {
		setBusy(true);
		try {
			await completeTask(task, notes.trim() || null, photos.length > 0 ? photos : null);
			toast.success("Task completed", { description: `Room ${roomLabel}` });
			setNotes("");
			setPhotos([]);
			onOpenChange(false);
			onCompleted();
		} catch (err) {
			const msg =
				err instanceof FolioApiError && err.blockers.length > 0
					? err.blockers.map((b) => b.message).join("; ")
					: err instanceof Error
						? err.message
						: "Complete failed";
			toast.error("Complete failed", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="complete-task-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<CheckCircle2 className="size-4" /> Complete task — Room {roomLabel}
					</SheetTitle>
					<SheetDescription>
						Attach after-cleaning photos so the supervisor and front desk can see the room state.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
					<div className="flex flex-col gap-2">
						<Label>After-cleaning photos</Label>
						<PhotoAttachList photos={photos} onChange={setPhotos} disabled={busy} />
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="completion-notes">Completion notes</Label>
						<Textarea
							id="completion-notes"
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							placeholder="Anything the supervisor should know"
							rows={3}
							disabled={busy}
						/>
					</div>
				</div>

				<SheetFooter>
					<Button onClick={submit} disabled={busy} data-testid="complete-task-submit">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
						Complete task
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
