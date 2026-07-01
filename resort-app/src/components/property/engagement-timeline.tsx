/**
 * EngagementTimeline — vertical timeline of every engagement tied to a
 * room / property / building / floor.
 *
 * Features:
 *   · Filter chips per event kind (bookings, stays, folios, payments,
 *     housekeeping, condition, moves, tickets).
 *   · Each entry is a link to its source ERPNext doc — opens the desk
 *     record so a manager can drill in without leaving the SPA.
 *   · framer-motion stagger + spring-in per entry, respects
 *     prefers-reduced-motion via the top-level MotionConfig.
 */

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
	BedDouble, Brush, ClipboardList, CreditCard, FileText,
	Move, Receipt, Wrench, ExternalLink, Loader2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { TimelineEvent, TimelineEventKind } from "@/lib/timeline-api";

const KIND_META: Record<TimelineEventKind, { label: string; color: string; Icon: typeof BedDouble }> = {
	reservation: { label: "Bookings", color: "bg-blue-500", Icon: FileText },
	stay: { label: "Stays", color: "bg-indigo-500", Icon: BedDouble },
	folio: { label: "Folios", color: "bg-violet-500", Icon: Receipt },
	payment: { label: "Payments", color: "bg-emerald-500", Icon: CreditCard },
	housekeeping: { label: "Housekeeping", color: "bg-cyan-500", Icon: Brush },
	condition: { label: "Condition", color: "bg-amber-500", Icon: ClipboardList },
	move: { label: "Room moves", color: "bg-rose-500", Icon: Move },
	ticket: { label: "Service", color: "bg-orange-500", Icon: Wrench },
};

function formatWhen(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(d);
}

function deskUrlFor(doctype: string, name: string): string {
	const slug = doctype.toLowerCase().replace(/\s+/g, "-");
	return `/app/${slug}/${encodeURIComponent(name)}`;
}

export function EngagementTimeline({
	events,
	loading,
	emptyLabel,
	title = "Engagement timeline",
}: {
	events: TimelineEvent[];
	loading?: boolean;
	emptyLabel?: string;
	title?: string;
}) {
	const kinds = useMemo(() => {
		const uniq = new Set<TimelineEventKind>();
		events.forEach((e) => uniq.add(e.kind));
		return Array.from(uniq);
	}, [events]);

	const [active, setActive] = useState<Set<TimelineEventKind>>(new Set());

	const filtered = useMemo(() => {
		if (active.size === 0) return events;
		return events.filter((e) => active.has(e.kind));
	}, [events, active]);

	function toggle(kind: TimelineEventKind) {
		setActive((prev) => {
			const next = new Set(prev);
			if (next.has(kind)) next.delete(kind);
			else next.add(kind);
			return next;
		});
	}

	return (
		<section className="flex flex-col gap-3" data-testid="engagement-timeline">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-lg font-medium">{title}</h2>
				<div className="flex flex-wrap gap-1">
					{kinds.map((k) => {
						const meta = KIND_META[k];
						const isActive = active.has(k);
						return (
							<Button
								key={k}
								size="sm"
								variant={isActive ? "default" : "outline"}
								onClick={() => toggle(k)}
								className="h-7 px-2 text-xs"
								data-testid={`filter-${k}`}
							>
								<span className={`mr-1 inline-block size-2 rounded-full ${meta.color}`} />
								{meta.label}
							</Button>
						);
					})}
					{active.size > 0 ? (
						<Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setActive(new Set())}>
							Clear
						</Button>
					) : null}
				</div>
			</div>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading timeline…
				</div>
			) : filtered.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						{emptyLabel ?? "No engagement history yet — events land here as bookings, stays, payments and housekeeping happen."}
					</CardContent>
				</Card>
			) : (
				<motion.ol
					className="relative ml-3 border-l border-border pl-6"
					variants={staggerContainer}
					initial="hidden"
					animate="show"
				>
					{filtered.map((e, i) => (
						<TimelineRow event={e} index={i} key={`${e.source_doctype}-${e.source_name}-${i}`} />
					))}
				</motion.ol>
			)}
		</section>
	);
}

function TimelineRow({ event, index }: { event: TimelineEvent; index: number }) {
	const meta = KIND_META[event.kind];
	const Icon = meta.Icon;
	const href = deskUrlFor(event.source_doctype, event.source_name);
	return (
		<motion.li
			className="relative mb-4 flex gap-3"
			variants={staggerItem}
			data-testid={`event-${index}`}
		>
			<span
				className={`absolute -left-[34px] flex size-6 items-center justify-center rounded-full text-white shadow ring-4 ring-background ${meta.color}`}
				aria-hidden
			>
				<Icon className="size-3.5" />
			</span>
			<div className="flex-1 rounded-md border bg-card px-3 py-2 transition-colors hover:bg-accent/40">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary" className="text-[10px]">{meta.label}</Badge>
					{event.status ? (
						<Badge variant="outline" className="text-[10px]">{event.status}</Badge>
					) : null}
					<span className="ml-auto text-xs text-muted-foreground">{formatWhen(event.when)}</span>
				</div>
				<div className="mt-1 flex items-start justify-between gap-2">
					<div>
						<div className="text-sm font-medium">{event.title}</div>
						{event.subtitle ? (
							<div className="text-xs text-muted-foreground">{event.subtitle}</div>
						) : null}
						{event.actor ? (
							<div className="mt-0.5 text-[11px] text-muted-foreground">by {event.actor}</div>
						) : null}
					</div>
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
						data-testid={`open-${event.source_doctype}-${event.source_name}`}
					>
						{event.source_name}
						<ExternalLink className="size-3" />
					</a>
				</div>
			</div>
		</motion.li>
	);
}
