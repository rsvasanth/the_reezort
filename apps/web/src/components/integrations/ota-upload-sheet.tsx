/**
 * OtaUploadSheet — paste or upload an OTA export and ingest it (spec 013).
 *
 * Source select + a paste textarea OR a .csv/.json file (read as text). Calls
 * ingest_payload and reports the batch summary; a re-upload of the same file
 * returns the prior batch (reused) and says so quietly.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { ingestPayload, type OtaSource } from "@/lib/ota-api";

const SOURCES: OtaSource[] = ["Booking.com", "Expedia", "Airbnb", "Agoda", "GDS", "Manual"];

type Props = {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	sources?: OtaSource[];
	onIngested?: () => void;
};

export function OtaUploadSheet({ open, onOpenChange, sources, onIngested }: Props) {
	const [source, setSource] = useState<OtaSource>("Booking.com");
	const [payload, setPayload] = useState("");
	const [filename, setFilename] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) {
			setSource("Booking.com");
			setPayload("");
			setFilename(undefined);
			setBusy(false);
		}
	}, [open]);

	function onFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		setFilename(file.name);
		const reader = new FileReader();
		reader.onload = () => setPayload(typeof reader.result === "string" ? reader.result : "");
		reader.readAsText(file);
	}

	async function submit() {
		if (busy) return;
		if (!payload.trim()) {
			toast.error("Paste or upload a file first");
			return;
		}
		setBusy(true);
		try {
			const res = await ingestPayload({ source, payload, filename });
			if (res.reused) {
				toast("File already uploaded", { description: `Using batch ${res.batch}` });
			} else {
				const extra: string[] = [];
				if (res.duplicate_count > 0) extra.push(`${res.duplicate_count} duplicate`);
				if (res.dead_letter_count > 0) extra.push(`${res.dead_letter_count} dead-letter`);
				toast.success(`Ingested ${res.success_count} message${res.success_count === 1 ? "" : "s"}`, {
					description: extra.length ? extra.join(" · ") : `Batch ${res.batch}`,
				});
			}
			onOpenChange(false);
			onIngested?.();
		} catch (error) {
			const msg = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
			toast.error("Ingest failed", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md" data-testid="ota-upload-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<Upload className="size-4" /> Import OTA reservations
					</SheetTitle>
					<SheetDescription>Paste a CSV/JSON export or upload a file. Re-uploads are de-duplicated.</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
					<div>
						<Label className="text-xs">Source</Label>
						<Select value={source} onValueChange={(v) => setSource(v as OtaSource)}>
							<SelectTrigger data-testid="ota-source"><SelectValue /></SelectTrigger>
							<SelectContent>
								{(sources && sources.length ? sources : SOURCES).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
							</SelectContent>
						</Select>
					</div>

					<div>
						<div className="mb-1 flex items-center justify-between">
							<Label className="text-xs">Payload</Label>
							<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fileRef.current?.click()}>
								<Upload className="mr-1 size-3" /> {filename ?? "Upload .csv / .json"}
							</Button>
							<input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={onFile} data-testid="ota-file" />
						</div>
						<Textarea
							value={payload}
							onChange={(e) => { setPayload(e.target.value); setFilename(undefined); }}
							placeholder={"Reservation number,Guest name,Check-in,Check-out,Total price,Currency\nBDC-90001,Meera Iyer,2026-07-20,2026-07-23,54000,INR"}
							rows={10}
							className="font-mono text-[11px]"
							data-testid="ota-payload"
						/>
					</div>
				</div>

				<SheetFooter className="border-t px-4 py-3">
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
					<Button onClick={submit} disabled={busy} data-testid="ota-ingest">
						{busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
						Import
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
