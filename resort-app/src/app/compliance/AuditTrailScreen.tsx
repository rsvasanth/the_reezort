/**
 * Audit Trail — searchable/filterable log of every recorded compliance event.
 * (spec 015-security-audit-compliance / ui-ux-audit-trail.md)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ExternalLink, FileSearch, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { listAuditActions, listAuditEvents, type AuditEvent } from "@/lib/approvals-api";

function formatDT(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", {
		day: "2-digit", month: "short", year: "numeric",
		hour: "2-digit", minute: "2-digit", second: "2-digit",
	}).format(d);
}

function deskUrl(doctype: string | null, name: string | null): string | null {
	if (!doctype || !name) return null;
	return `/app/${doctype.toLowerCase().replace(/\s+/g, "-")}/${encodeURIComponent(name)}`;
}

export default function AuditTrailScreen() {
	const [events, setEvents] = useState<AuditEvent[]>([]);
	const [actions, setActions] = useState<string[]>([]);
	const [action, setAction] = useState<string>("all");
	const [actor, setActor] = useState<string>("");
	const [sourceDoctype, setSourceDoctype] = useState<string>("");
	const [days, setDays] = useState<string>("14");
	const [loading, setLoading] = useState(true);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const [ev, ac] = await Promise.all([
				listAuditEvents({
					action: action === "all" ? undefined : action,
					actor: actor || undefined,
					source_doctype: sourceDoctype || undefined,
					days: parseInt(days, 10) || 14,
					limit: 500,
				}),
				listAuditActions().catch(() => ({ actions: [] as string[] })),
			]);
			setEvents(ev.events);
			setActions(ac.actions);
		} finally {
			setLoading(false);
		}
	}, [action, actor, sourceDoctype, days]);

	useEffect(() => { reload(); }, [reload]);

	const doctypes = useMemo(() => {
		const set = new Set<string>();
		events.forEach((e) => { if (e.source_doctype) set.add(e.source_doctype); });
		return Array.from(set).sort();
	}, [events]);

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6" data-testid="audit-trail">
			<header>
				<Badge variant="outline" className="mb-2 gap-1">
					<FileSearch className="size-3" /> Compliance
				</Badge>
				<h1 className="text-3xl font-light text-foreground md:text-4xl">Audit trail</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Every recorded correction, approval decision, and controlled action.
				</p>
			</header>

			<Card>
				<CardContent className="grid gap-3 py-4 md:grid-cols-5">
					<div>
						<Label className="text-xs">Action</Label>
						<Select value={action} onValueChange={setAction}>
							<SelectTrigger data-testid="filter-action">
								<SelectValue placeholder="Any action" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Any action</SelectItem>
								{actions.map((a) => (
									<SelectItem key={a} value={a}>{a}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div>
						<Label className="text-xs">Actor (email)</Label>
						<Input
							placeholder="e.g. gm@thereezort.com"
							value={actor}
							onChange={(e) => setActor(e.target.value)}
							data-testid="filter-actor"
						/>
					</div>
					<div>
						<Label className="text-xs">Source doctype</Label>
						<Select value={sourceDoctype || "any"} onValueChange={(v) => setSourceDoctype(v === "any" ? "" : v)}>
							<SelectTrigger data-testid="filter-doctype">
								<SelectValue placeholder="Any doctype" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="any">Any doctype</SelectItem>
								{doctypes.map((d) => (
									<SelectItem key={d} value={d}>{d}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div>
						<Label className="text-xs">Range (days)</Label>
						<Input
							type="number"
							min="1"
							max="365"
							value={days}
							onChange={(e) => setDays(e.target.value)}
							data-testid="filter-days"
						/>
					</div>
					<div className="flex items-end">
						<Button onClick={reload} className="w-full" data-testid="apply-filters">Apply</Button>
					</div>
				</CardContent>
			</Card>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading events…
				</div>
			) : events.length === 0 ? (
				<Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
					No matching events in the last {days} days.
				</CardContent></Card>
			) : (
				<motion.ol
					className="relative ml-3 border-l border-border pl-6"
					variants={staggerContainer}
					initial="hidden"
					animate="show"
					data-testid="audit-list"
				>
					{events.map((e) => (
						<AuditRow key={e.name} event={e} />
					))}
				</motion.ol>
			)}
		</main>
	);
}

function AuditRow({ event }: { event: AuditEvent }) {
	const desk = deskUrl(event.source_doctype, event.source_name);
	const parsedKeys = event.details_parsed ? Object.keys(event.details_parsed).slice(0, 4) : [];
	return (
		<motion.li className="relative mb-4 flex gap-3" variants={staggerItem} data-testid={`audit-${event.name}`}>
			<span
				className="absolute -left-[34px] flex size-6 items-center justify-center rounded-full bg-stone-500 text-white shadow ring-4 ring-background"
				aria-hidden
			>
				<FileSearch className="size-3.5" />
			</span>
			<div className="flex-1 rounded-md border bg-card px-3 py-2">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary" className="text-[10px]">{event.action}</Badge>
					{event.source_doctype ? (
						<Badge variant="outline" className="text-[10px]">{event.source_doctype}</Badge>
					) : null}
					<span className="ml-auto text-xs text-muted-foreground">{formatDT(event.at)}</span>
				</div>
				<div className="mt-1 flex items-start justify-between gap-2">
					<div className="min-w-0">
						{event.source_name ? (
							<div className="text-sm font-medium">{event.source_name}</div>
						) : null}
						{event.reason ? (
							<div className="mt-0.5 text-xs text-muted-foreground">{event.reason}</div>
						) : null}
						<div className="mt-0.5 text-[11px] text-muted-foreground">
							{event.actor_name || event.actor || "system"}
						</div>
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
						<a
							href={desk}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
						>
							Open <ExternalLink className="size-3" />
						</a>
					) : null}
				</div>
			</div>
		</motion.li>
	);
}
