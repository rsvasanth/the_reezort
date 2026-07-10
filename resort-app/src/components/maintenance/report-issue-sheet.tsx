/**
 * ReportIssueSheet — one-call maintenance report (spec 009).
 *
 * Launched from the inbox header (room optional) or a room card (room preset).
 * Handles the two behavioural quirks of create_ticket:
 *  · `warnings: [{code:"similar_open"}]` → yellow banner, "Link" opens the
 *    existing ticket, "Report anyway" resends with allow_duplicate.
 *  · `reused: true` → subtle "already reported" toast, not a shout.
 *
 * Photos are deferred to a follow-up slice — the payload stays forward-
 * compatible (CreateTicketPayload.photos), the attach UI is not built yet.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

import { FolioApiError } from "@/lib/folio-api";
import {
	createTicket,
	type MaintenanceCategory,
	type MaintenancePriority,
} from "@/lib/maintenance-api";

const CATEGORIES: MaintenanceCategory[] = [
	"HVAC", "Plumbing", "Electrical", "Structural", "IT", "Housekeeping Equipment", "Landscape", "Other",
];
const PRIORITIES: MaintenancePriority[] = ["Low", "Normal", "High", "Urgent"];

type Props = {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	resortProperty: string;
	room?: string | null;
	guest?: string | null;
	stay?: string | null;
	sourceDoctype?: string | null;
	sourceName?: string | null;
	onCreated?: () => void;
};

export function ReportIssueSheet({
	open,
	onOpenChange,
	resortProperty,
	room,
	guest,
	stay,
	sourceDoctype,
	sourceName,
	onCreated,
}: Props) {
	const roomPreset = !!room;
	const [roomInput, setRoomInput] = useState(room ?? "");
	const [category, setCategory] = useState<MaintenanceCategory>("HVAC");
	const [priority, setPriority] = useState<MaintenancePriority>("Normal");
	const [subject, setSubject] = useState("");
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const [similar, setSimilar] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setRoomInput(room ?? "");
			setCategory("HVAC");
			setPriority("Normal");
			setSubject("");
			setDescription("");
			setSimilar(null);
			setBusy(false);
		}
	}, [open, room]);

	async function submit(allowDuplicate: boolean) {
		if (busy) return;
		if (!subject.trim()) {
			toast.error("Add a short subject");
			return;
		}
		setBusy(true);
		try {
			const env = await createTicket({
				resort_property: resortProperty,
				subject: subject.trim(),
				category,
				priority,
				room: roomInput.trim() || null,
				stay: stay ?? null,
				guest: guest ?? null,
				description: description.trim() || null,
				source_doctype: sourceDoctype ?? null,
				source_name: sourceName ?? null,
				allow_duplicate: allowDuplicate,
			});

			const dup = (env.warnings ?? []).find((w) => w.code === "similar_open");
			if (dup && !allowDuplicate) {
				const existing = (dup as unknown as { detail?: { existing?: string } }).detail?.existing ?? null;
				setSimilar(existing);
				setBusy(false);
				return;
			}

			const data = env.data;
			if (data?.reused) {
				toast("Already reported", { description: `Updated ${data.ticket.name}` });
			} else {
				toast.success(`Ticket ${data?.ticket.name} created`, { description: "Maintenance has been notified." });
			}
			onOpenChange(false);
			onCreated?.();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Could not create ticket", { description: msg });
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="report-issue-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<Wrench className="size-4" /> Report issue{roomPreset ? ` · ${room}` : ""}
					</SheetTitle>
					<SheetDescription>
						{guest ? `${guest} · ` : ""}creates a maintenance ticket and notifies the team.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
					{similar ? (
						<div className="flex flex-col gap-2 rounded-lg border border-[#b28600]/40 bg-[#b28600]/10 p-3 text-sm">
							<div className="flex items-start gap-2 text-[#684e00] dark:text-[#f1c21b]">
								<AlertTriangle className="mt-0.5 size-4 shrink-0" />
								<span>A similar open ticket already exists for this room and category.</span>
							</div>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() => {
										window.location.hash = `#/maintenance?ticket=${encodeURIComponent(similar)}`;
										onOpenChange(false);
									}}
								>
									Open {similar}
								</Button>
								<Button size="sm" variant="ghost" onClick={() => submit(true)} disabled={busy}>
									Report anyway
								</Button>
							</div>
						</div>
					) : null}

					{!roomPreset ? (
						<div>
							<Label className="text-xs">Room (optional)</Label>
							<Input
								value={roomInput}
								onChange={(e) => setRoomInput(e.target.value)}
								placeholder="e.g. REEZORT-V4 — leave blank for common areas"
								data-testid="report-room"
							/>
						</div>
					) : null}

					<div>
						<Label className="text-xs">Subject</Label>
						<Input
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							placeholder="AC not cooling"
							data-testid="report-subject"
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div>
							<Label className="text-xs">Category</Label>
							<Select value={category} onValueChange={(v) => setCategory(v as MaintenanceCategory)}>
								<SelectTrigger data-testid="report-category"><SelectValue /></SelectTrigger>
								<SelectContent>
									{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label className="text-xs">Priority</Label>
							<Select value={priority} onValueChange={(v) => setPriority(v as MaintenancePriority)}>
								<SelectTrigger data-testid="report-priority"><SelectValue /></SelectTrigger>
								<SelectContent>
									{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div>
						<Label className="text-xs">Description</Label>
						<Textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Guest reports the room stays warm with the AC set to 18°C…"
							rows={4}
							data-testid="report-description"
						/>
					</div>
				</div>

				<SheetFooter className="border-t px-4 py-3">
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
					<Button onClick={() => submit(false)} disabled={busy} data-testid="report-submit">
						{busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
						Report issue
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
