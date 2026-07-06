/**
 * InspectionSheet — supervisor records the room inspection outcome.
 *
 * Collects outcome + notes + readiness photos, then create_inspection →
 * record_inspection. A "Passed" outcome requires at least one photo — that
 * photo set is the room's official service-ready evidence, preloaded into
 * the front-desk check-in flow via get_room_readiness.
 */

import { useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
import {
	createInspection,
	FolioApiError,
	recordInspection,
	type InspectionOutcome,
	type TaskPhoto,
} from "@/lib/housekeeping-api";

const OUTCOMES: InspectionOutcome[] = [
	"Passed",
	"Failed",
	"Rework Required",
	"Maintenance Required",
	"Accepted With Exception",
];

export function InspectionSheet({
	open,
	onOpenChange,
	task,
	roomLabel,
	onRecorded,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	task: string;
	roomLabel: string;
	onRecorded: () => void;
}) {
	const [outcome, setOutcome] = useState<InspectionOutcome>("Passed");
	const [notes, setNotes] = useState("");
	const [photos, setPhotos] = useState<TaskPhoto[]>([]);
	const [busy, setBusy] = useState(false);

	const needsPhoto = outcome === "Passed" && photos.length === 0;

	async function submit() {
		if (needsPhoto) {
			toast.error("Add at least one room-ready photo to pass the inspection");
			return;
		}
		setBusy(true);
		try {
			const created = await createInspection(task);
			if (!created.ok || !created.data) throw new Error("Could not create the inspection");
			await recordInspection(
				created.data.inspection.name,
				outcome,
				notes.trim() || null,
				null,
				photos.length > 0 ? photos : null
			);
			toast.success(`Inspection recorded — ${outcome}`, { description: `Room ${roomLabel}` });
			setOutcome("Passed");
			setNotes("");
			setPhotos([]);
			onOpenChange(false);
			onRecorded();
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

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="inspection-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<ClipboardCheck className="size-4" /> Inspect room {roomLabel}
					</SheetTitle>
					<SheetDescription>
						Passed inspections need at least one photo — front desk sees it as the room-ready proof at check-in.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
					<div className="flex flex-col gap-2">
						<Label>Outcome</Label>
						<Select value={outcome} onValueChange={(v) => setOutcome(v as InspectionOutcome)} disabled={busy}>
							<SelectTrigger data-testid="inspection-outcome">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{OUTCOMES.map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-2">
						<Label>Room-ready photos {outcome === "Passed" ? <span className="text-destructive">*</span> : null}</Label>
						<PhotoAttachList photos={photos} onChange={setPhotos} disabled={busy} />
						{needsPhoto ? (
							<p className="text-xs text-muted-foreground">Required for a Passed outcome.</p>
						) : null}
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="inspection-notes">Notes</Label>
						<Textarea
							id="inspection-notes"
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							placeholder="Inspection remarks"
							rows={3}
							disabled={busy}
						/>
					</div>
				</div>

				<SheetFooter>
					<Button onClick={submit} disabled={busy || needsPhoto} data-testid="inspection-submit">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
						Record inspection
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
