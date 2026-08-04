/**
 * Shared record-workspace primitives — the Folio-Workspace pattern, generalized
 * so every module's list + detail views look and behave consistently.
 *
 *   WorkspacePage  — full-page shell. The page's identity (badge, title,
 *                    subtitle) is published to the app bar rather than drawn
 *                    again below it: a 150px title block on every screen
 *                    restated what the sidebar already says, and operational
 *                    screens need the vertical space more than the restatement.
 *   RecordHeader   — the record header card (avatar/icon, title, links, id, status, meta).
 *   KpiStrip       — the metric tiles row.
 *
 * Side sheets are reserved for tiny quick actions only — primary detail/create live
 * on their own full-page routes.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";

import { GuestAvatar } from "@/components/guest-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { pageEnter, staggerContainer, staggerItem, fadeIn } from "@/lib/motion";

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export interface PageMeta {
	badge?: string;
	tag?: string;
	title: ReactNode;
	subtitle?: ReactNode;
	onBack?: () => void;
}

const PageMetaContext = createContext<{
	meta: PageMeta | null;
	setMeta: (m: PageMeta | null) => void;
}>({ meta: null, setMeta: () => {} });

/** Lets the app bar show which page you are on. Wrap the whole app once. */
export function PageMetaProvider({ children }: { children: ReactNode }) {
	const [meta, setMeta] = useState<PageMeta | null>(null);
	const value = useMemo(() => ({ meta, setMeta }), [meta]);
	return <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>;
}

export function usePageMeta() {
	return useContext(PageMetaContext);
}

export function WorkspacePage({
	badge,
	tag,
	title,
	subtitle,
	actions,
	onBack,
	testId,
	children,
}: {
	badge?: string;
	tag?: string;
	title: ReactNode;
	subtitle?: ReactNode;
	actions?: ReactNode;
	onBack?: () => void;
	testId?: string;
	children: ReactNode;
}) {
	const { setMeta } = usePageMeta();
	useEffect(() => {
		setMeta({ badge, tag, title, subtitle, onBack });
		return () => setMeta(null);
		// `onBack` is a fresh closure each render on some screens, so it is
		// deliberately not a dependency — re-registering on every render would loop.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [badge, tag, title, subtitle, setMeta]);

	return (
		<motion.main
			data-testid={testId}
			variants={pageEnter}
			initial="hidden"
			animate="show"
			className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 lg:px-6"
		>
			{actions ? (
				<div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
			) : null}
			{children}
		</motion.main>
	);
}

export type Kpi = { label: string; value: ReactNode; accent?: "danger" | "warn" | "good" };

export function KpiStrip({ items }: { items: Kpi[] }) {
	return (
		<motion.div
			variants={staggerContainer}
			initial="hidden"
			animate="show"
			className="grid gap-3"
			style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
		>
			{items.map((k) => (
				<motion.div key={k.label} variants={staggerItem} whileHover={{ y: -2 }}>
					<Card>
						<CardContent className="p-4">
							<div className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</div>
							<div
								className={cn(
									"mt-1 text-xl font-semibold tabular-nums",
									k.accent === "danger" && "text-destructive",
									k.accent === "warn" && "text-warning",
									k.accent === "good" && "text-success"
								)}
							>
								{k.value}
							</div>
						</CardContent>
					</Card>
				</motion.div>
			))}
		</motion.div>
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
		<motion.div variants={fadeIn} initial="hidden" animate="show">
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
		</motion.div>
	);
}
