/**
 * OtaReviewSheet — review one OTA message and convert or reject (spec 013).
 *
 * Loads get_message for parsed fields + raw payload + similar-reservation
 * hints. Convert is gated to New messages (backend refuses otherwise and
 * returns blockers, surfaced inline). Reject needs a reason (inline, required).
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
	convertToReservation,
	getMessage,
	rejectMessage,
	type MessageDetail,
} from "@/lib/ota-api";

import { formatDateShort, nights, stateTone } from "@/app/integrations/ota-format";

/**
 * Best human message from an API error. The backend often uses frappe.throw
 * (HTTP 417) whose reason lands in `exception`/`_server_messages`, not the
 * envelope `blockers[]` — so a bare error.message reads "… failed with 417".
 * Prefer blockers, then the thrown exception (stripped of its class prefix),
 * then _server_messages, then the raw message.
 */
function bestError(error: unknown): string {
	if (!(error instanceof FolioApiError)) return String(error);
	if (error.blockers[0]?.message) return error.blockers[0].message;
	const raw = error.rawEnvelope as { exception?: string; _server_messages?: string } | undefined;
	const exc = raw?.exception;
	if (typeof exc === "string" && exc.includes(":")) {
		return exc.slice(exc.indexOf(":") + 1).trim();
	}
	if (typeof raw?._server_messages === "string") {
		try {
			const arr = JSON.parse(raw._server_messages) as string[];
			const first = JSON.parse(arr[0]) as { message?: string };
			if (first.message) return first.message.replace(/<[^>]+>/g, "");
		} catch {
			// fall through
		}
	}
	return error.message;
}

function formatMoney(n: number | null, currency: string | null): string {
	if (n === null) return "—";
	try {
		return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(n);
	} catch {
		return `${n} ${currency ?? ""}`.trim();
	}
}

type Props = {
	name: string | null;
	open: boolean;
	onOpenChange: (v: boolean) => void;
	onActioned?: () => void;
};

export function OtaReviewSheet({ name, open, onOpenChange, onActioned }: Props) {
	const [detail, setDetail] = useState<MessageDetail | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState("");
	const [rawOpen, setRawOpen] = useState(false);
	const [blocker, setBlocker] = useState<string | null>(null);

	const load = useCallback(() => {
		if (!name) return;
		setLoading(true);
		setDetail(null);
		setRejecting(false);
		setReason("");
		setRawOpen(false);
		setBlocker(null);
		getMessage(name)
			.then(setDetail)
			.catch((error: unknown) => {
				const msg = bestError(error);
				toast.error("Could not load message", { description: msg });
			})
			.finally(() => setLoading(false));
	}, [name]);

	useEffect(() => {
		if (open) load();
	}, [open, load]);

	const m = detail?.message;

	async function convert() {
		if (!m || busy) return;
		setBusy(true);
		setBlocker(null);
		try {
			const res = await convertToReservation(m.name);
			toast.success(`Converted → ${res.reservation}`, {
				action: { label: "Open reservation", onClick: () => { window.location.hash = `#/reservations/${res.reservation}`; } },
			});
			onOpenChange(false);
			onActioned?.();
		} catch (error) {
			const msg = bestError(error);
			setBlocker(msg);
		} finally {
			setBusy(false);
		}
	}

	async function reject() {
		if (!m || busy) return;
		if (!reason.trim()) {
			toast.error("A reason is required to reject");
			return;
		}
		setBusy(true);
		try {
			await rejectMessage(m.name, reason.trim());
			toast.success("Message rejected");
			onOpenChange(false);
			onActioned?.();
		} catch (error) {
			const msg = bestError(error);
			toast.error("Could not reject", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	const tone = m ? stateTone(m.state) : null;
	const stayNights = m ? nights(m.parsed_arrival, m.parsed_departure) : null;
	const similar = detail?.similar_reservations ?? [];
	const hardDupe = similar.some((s) => s.match === "external_id");

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg" data-testid="ota-review-sheet">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<UserRound className="size-4" /> {m?.parsed_guest_name ?? "OTA message"}
						{tone ? <Badge variant="outline" className={`text-[10px] ${tone.badge}`}>{tone.label}</Badge> : null}
					</SheetTitle>
					<SheetDescription>
						{m ? `${m.source} · ${m.external_id}` : name}
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
					{loading || !m ? (
						<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading…
						</div>
					) : (
						<>
							{similar.length ? (
								<div className={`flex flex-col gap-1.5 rounded-lg border p-3 text-sm ${hardDupe ? "border-destructive/40 bg-destructive/10" : "border-amber-500/40 bg-amber-500/10"}`}>
									<div className={`flex items-start gap-2 ${hardDupe ? "text-destructive" : "text-amber-700 dark:text-amber-300"}`}>
										<AlertTriangle className="mt-0.5 size-4 shrink-0" />
										<span>
											{hardDupe
												? "A reservation already carries this external id — convert will be blocked."
												: "A similar reservation exists (same guest and dates). Review before converting."}
										</span>
									</div>
									{similar.map((s) => (
										<a key={s.reservation} href={`#/reservations/${s.reservation}`} className="ml-6 font-mono text-xs hover:underline">
											{s.reservation} · {s.status} · {formatDateShort(s.arrival_date)}–{formatDateShort(s.departure_date)}
										</a>
									))}
								</div>
							) : null}

							{m.state === "Dead-letter" && m.dead_letter_error ? (
								<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
									Parse failed: {m.dead_letter_error}. It will retry automatically after an adapter fix.
								</div>
							) : null}
							{m.state === "Rejected" && m.rejection_reason ? (
								<div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">Rejected — {m.rejection_reason}</div>
							) : null}
							{m.state === "Converted" && m.converted_reservation ? (
								<a href={`#/reservations/${m.converted_reservation}`} className="rounded-lg border bg-muted/40 p-3 text-sm hover:underline">
									Converted → <span className="font-mono">{m.converted_reservation}</span>
								</a>
							) : null}

							<dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-3 text-sm">
								<Field label="Guest" value={m.parsed_guest_name} />
								<Field label="Contact" value={m.parsed_email ?? m.parsed_phone} />
								<Field label="Arrival" value={formatDateShort(m.parsed_arrival)} />
								<Field label="Departure" value={`${formatDateShort(m.parsed_departure)}${stayNights !== null ? ` · ${stayNights}n` : ""}`} />
								<Field label="Guests" value={`${m.parsed_adults ?? 0} adult${m.parsed_adults === 1 ? "" : "s"}${m.parsed_children ? ` · ${m.parsed_children} child` : ""}`} />
								<Field label="Room / rate" value={[m.parsed_room_type_code, m.parsed_rate_code].filter(Boolean).join(" · ") || "—"} />
								<Field label="Total" value={formatMoney(m.parsed_total, m.parsed_currency)} />
								<Field label="Received" value={formatDateShort(m.received_at ? m.received_at.slice(0, 10) : null)} />
							</dl>

							{detail?.raw_payload ? (
								<div className="rounded-lg border">
									<button type="button" onClick={() => setRawOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-sm" data-testid="ota-raw-toggle">
										<span className="text-muted-foreground">Raw payload</span>
										<ChevronDown className={`size-4 transition-transform ${rawOpen ? "rotate-180" : ""}`} />
									</button>
									{rawOpen ? (
										<pre className="max-h-56 overflow-auto border-t bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed">{detail.raw_payload}</pre>
									) : null}
								</div>
							) : null}

							{blocker ? (
								<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{blocker}</div>
							) : null}

							{rejecting ? (
								<div className="flex flex-col gap-2">
									<Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this message being rejected?" rows={3} data-testid="ota-reject-reason" />
								</div>
							) : null}
						</>
					)}
				</div>

				{m ? (
					<SheetFooter className="border-t px-4 py-3">
						{m.state === "New" && !rejecting ? (
							<>
								<Button variant="ghost" onClick={() => setRejecting(true)} disabled={busy}>Reject</Button>
								<Button onClick={convert} disabled={busy} className="bg-brass text-brass-foreground hover:bg-brass/90" data-testid="ota-convert">
									{busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
									Convert to reservation
								</Button>
							</>
						) : rejecting ? (
							<>
								<Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>Cancel</Button>
								<Button variant="destructive" onClick={reject} disabled={busy} data-testid="ota-reject-confirm">
									{busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
									Confirm reject
								</Button>
							</>
						) : (
							<Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
						)}
					</SheetFooter>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function Field({ label, value }: { label: string; value: string | null }) {
	return (
		<div>
			<dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
			<dd className="mt-0.5 truncate text-sm">{value || "—"}</dd>
		</div>
	);
}
