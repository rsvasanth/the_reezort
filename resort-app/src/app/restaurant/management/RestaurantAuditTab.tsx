/**
 * RestaurantAuditTab — every recorded action on a Restaurant Order (voids,
 * cancels, KOT transitions, waiter assignment), the manager's dispute and
 * shift-close investigation feed. Scoped to source_doctype = "Restaurant
 * Order" over the shared audit log.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { ExternalLink, FileSearch, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import { listAuditEvents, type AuditEvent } from "@/lib/approvals-api";

function formatDT(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", {
		day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
	}).format(d);
}

function deskUrl(name: string | null): string | null {
	if (!name) return null;
	return `/app/restaurant-order/${encodeURIComponent(name)}`;
}

export default function RestaurantAuditTab() {
	const [events, setEvents] = useState<AuditEvent[]>([]);
	const [days, setDays] = useState("14");
	const [state, setState] = useState<"loading" | "ready" | "denied">("loading");

	const reload = useCallback(async () => {
		setState("loading");
		try {
			const res = await listAuditEvents({
				source_doctype: "Restaurant Order",
				days: parseInt(days, 10) || 14,
				limit: 500,
			});
			setEvents(res.events);
			setState("ready");
		} catch (error) {
			if (error instanceof FolioApiError && error.status === 403) {
				setState("denied");
				return;
			}
			setEvents([]);
			setState("ready");
		}
	}, [days]);

	useEffect(() => {
		reload();
	}, [reload]);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<p className="text-sm text-muted-foreground">Every recorded action on a restaurant order.</p>
				<div className="flex items-end gap-2">
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs text-muted-foreground">Range (days)</Label>
						<Input type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} className="w-28" data-testid="audit-days" />
					</div>
					<Button onClick={reload} data-testid="audit-apply">Apply</Button>
				</div>
			</div>

			{state === "loading" ? (
				<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading events…
				</div>
			) : state === "denied" ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						You do not have permission to view the audit trail. Ask a manager.
					</CardContent>
				</Card>
			) : events.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						No restaurant order events in the last {days} days.
					</CardContent>
				</Card>
			) : (
				<motion.ol
					className="relative ml-3 border-l border-border pl-6"
					variants={staggerContainer}
					initial="hidden"
					animate="show"
					data-testid="restaurant-audit-list"
				>
					{events.map((e) => (
						<AuditRow key={e.name} event={e} />
					))}
				</motion.ol>
			)}
		</div>
	);
}

function AuditRow({ event }: { event: AuditEvent }) {
	const desk = deskUrl(event.source_name);
	const parsedKeys = event.details_parsed ? Object.keys(event.details_parsed).slice(0, 4) : [];
	return (
		<motion.li className="relative mb-4 flex gap-3" variants={staggerItem} data-testid={`audit-${event.name}`}>
			<span
				className="absolute -left-[34px] flex size-6 items-center justify-center rounded-full bg-muted-foreground text-white shadow ring-4 ring-background"
				aria-hidden
			>
				<FileSearch className="size-3.5" />
			</span>
			<div className="flex-1 rounded-md border bg-card px-3 py-2">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary" className="text-[10px]">{event.action}</Badge>
					<span className="ml-auto text-xs text-muted-foreground">{formatDT(event.at)}</span>
				</div>
				<div className="mt-1 flex items-start justify-between gap-2">
					<div className="min-w-0">
						{event.source_name ? <div className="text-sm font-medium">{event.source_name}</div> : null}
						{event.reason ? <div className="mt-0.5 text-xs text-muted-foreground">{event.reason}</div> : null}
						<div className="mt-0.5 text-[11px] text-muted-foreground">{event.actor_name || event.actor || "system"}</div>
						{parsedKeys.length > 0 ? (
							<div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
								{parsedKeys.map((k) => (
									<span key={k} className="rounded-md bg-muted/40 px-1.5 py-0.5">
										{k}: {String(event.details_parsed?.[k] ?? "").slice(0, 30)}
									</span>
								))}
							</div>
						) : null}
					</div>
					{desk ? (
						<a href={desk} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline">
							Open <ExternalLink className="size-3" />
						</a>
					) : null}
				</div>
			</div>
		</motion.li>
	);
}
