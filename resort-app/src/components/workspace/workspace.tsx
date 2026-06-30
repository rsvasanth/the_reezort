/**
 * Shared record-workspace primitives — the Folio-Workspace pattern, generalized
 * so every module's list + detail views look and behave consistently.
 *
 *   WorkspacePage  — full-page shell: badge + title + subtitle + actions, then body.
 *   RecordHeader   — the record header card (avatar/icon, title, links, id, status, meta).
 *   KpiStrip       — the metric tiles row.
 *
 * Side sheets are reserved for tiny quick actions only — primary detail/create live
 * on their own full-page routes.
 */

import type { ReactNode } from "react";

import { GuestAvatar } from "@/components/guest-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export function WorkspacePage({
	badge,
	tag,
	title,
	subtitle,
	actions,
	onBack,
	children,
}: {
	badge?: string;
	tag?: string;
	title: ReactNode;
	subtitle?: ReactNode;
	actions?: ReactNode;
	onBack?: () => void;
	children: ReactNode;
}) {
	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="mb-2 flex items-center gap-2">
						{onBack ? (
							<button
								type="button"
								onClick={onBack}
								className="text-sm text-muted-foreground hover:text-foreground"
							>
								← Back
							</button>
						) : null}
						{badge ? <Badge variant="outline">{badge}</Badge> : null}
						{tag ? <Badge variant="secondary">{tag}</Badge> : null}
					</div>
					<h1 className="text-3xl font-light leading-tight text-foreground md:text-4xl">{title}</h1>
					{subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
				</div>
				{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
			</header>
			{children}
		</main>
	);
}

export type Kpi = { label: string; value: ReactNode; accent?: "danger" | "warn" | "good" };

export function KpiStrip({ items }: { items: Kpi[] }) {
	return (
		<div
			className="grid gap-3"
			style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
		>
			{items.map((k) => (
				<Card key={k.label}>
					<CardContent className="p-4">
						<div className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</div>
						<div
							className={cn(
								"mt-1 text-xl font-semibold tabular-nums",
								k.accent === "danger" && "text-destructive",
								k.accent === "warn" && "text-amber-600",
								k.accent === "good" && "text-emerald-600"
							)}
						>
							{k.value}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

export type HeaderLink = { label: string; icon?: ReactNode };
export type HeaderStatus = { label: string; variant?: BadgeVariant };
export type MetaPair = { label: string; value: ReactNode };

export function RecordHeader({
	avatarName,
	avatarUrl,
	icon,
	title,
	subtitle,
	idChip,
	onCopyId,
	links,
	statuses,
	meta,
	actions,
}: {
	avatarName?: string;
	avatarUrl?: string | null;
	icon?: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	idChip?: string;
	onCopyId?: () => void;
	links?: HeaderLink[];
	statuses?: HeaderStatus[];
	meta?: MetaPair[];
	actions?: ReactNode;
}) {
	return (
		<Card>
			<CardContent className="flex flex-col gap-4 p-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex items-center gap-4">
						{avatarName !== undefined ? (
							<GuestAvatar name={avatarName} imageUrl={avatarUrl} size="lg" />
						) : icon ? (
							<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
								{icon}
							</div>
						) : null}
						<div>
							<h2 className="text-2xl font-semibold leading-tight">{title}</h2>
							{subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
							{links?.length ? (
								<div className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
									{links.map((l, i) => (
										<span key={i} className="inline-flex items-center gap-1">
											{l.icon}
											{l.label}
										</span>
									))}
								</div>
							) : null}
						</div>
					</div>
					<div className="flex flex-col items-end gap-2">
						{idChip ? (
							<Badge
								variant="outline"
								className={cn("font-mono", onCopyId && "cursor-pointer")}
								onClick={onCopyId}
							>
								{idChip}
							</Badge>
						) : null}
						{statuses?.length ? (
							<div className="flex flex-wrap justify-end gap-1.5">
								{statuses.map((s, i) => (
									<Badge key={i} variant={s.variant ?? "secondary"}>
										{s.label}
									</Badge>
								))}
							</div>
						) : null}
					</div>
				</div>

				{meta?.length ? (
					<>
						<Separator />
						<div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
							{meta.map((m, i) => (
								<span key={i}>
									<span className="text-muted-foreground">{m.label} </span>
									<span className="font-medium">{m.value}</span>
								</span>
							))}
						</div>
					</>
				) : null}

				{actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
			</CardContent>
		</Card>
	);
}
