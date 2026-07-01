/**
 * NotificationBell — SiteHeader dropdown with unread count + per-user list.
 * Polls every 30s (Frappe react SDK doesn't expose a socket hook here); the
 * backend also publishes `new_notification` over socket.io for future wiring.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Check, CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
	deskUrlForNotification,
	listMyNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	type NotificationRow,
} from "@/lib/notify-api";

const POLL_MS = 30_000;

function timeAgo(iso: string | null): string {
	if (!iso) return "";
	const d = new Date(iso.replace(" ", "T"));
	const s = Math.max(1, Math.round((Date.now() - d.getTime()) / 1000));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86_400)}d ago`;
}

export function NotificationBell() {
	const [rows, setRows] = useState<NotificationRow[]>([]);
	const [unread, setUnread] = useState<number>(0);
	const [loading, setLoading] = useState<boolean>(true);
	const [open, setOpen] = useState(false);

	const reload = useCallback(async () => {
		try {
			const res = await listMyNotifications(false, 15);
			setRows(res.notifications);
			setUnread(res.unread_count);
		} catch {
			// Silent: bell shouldn't nag the user if API isn't up.
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		reload();
		const id = window.setInterval(reload, POLL_MS);
		return () => window.clearInterval(id);
	}, [reload]);

	async function onMarkRead(row: NotificationRow) {
		if (row.read) return;
		try {
			await markNotificationRead(row.name);
			setRows((prev) => prev.map((r) => (r.name === row.name ? { ...r, read: 1 } : r)));
			setUnread((n) => Math.max(0, n - 1));
		} catch {
			// no-op
		}
	}

	async function onMarkAll() {
		try {
			const res = await markAllNotificationsRead();
			setRows((prev) => prev.map((r) => ({ ...r, read: 1 })));
			setUnread(0);
			if (res.cleared > 0) toast.success(`Cleared ${res.cleared} notification${res.cleared === 1 ? "" : "s"}`);
		} catch {
			toast.error("Could not mark all as read");
		}
	}

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="relative"
					aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
					data-testid="notification-bell"
				>
					<Bell className="size-4" />
					{unread > 0 ? (
						<span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold leading-none text-destructive-foreground">
							{unread > 99 ? "99+" : unread}
						</span>
					) : null}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-80 p-0" data-testid="notification-panel">
				<div className="flex items-center justify-between border-b px-3 py-2">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium">Notifications</span>
						{unread > 0 ? (
							<Badge variant="secondary" className="text-[10px]">{unread} new</Badge>
						) : null}
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={onMarkAll}
						disabled={unread === 0}
						data-testid="mark-all-read"
					>
						<CheckCheck className="size-3.5" /> Mark all read
					</Button>
				</div>

				<div className="max-h-[70vh] overflow-y-auto">
					{loading ? (
						<div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading…
						</div>
					) : rows.length === 0 ? (
						<div className="px-3 py-6 text-center text-sm text-muted-foreground">
							Nothing new — assignments and follow-ups will land here.
						</div>
					) : (
						<AnimatePresence initial={false}>
							<motion.ul
								className="flex flex-col"
								variants={staggerContainer}
								initial="hidden"
								animate="show"
							>
								{rows.map((row) => {
									const desk = deskUrlForNotification(row);
									return (
										<motion.li
											key={row.name}
											variants={staggerItem}
											className={`group flex items-start gap-2 border-b px-3 py-2 last:border-b-0 ${row.read ? "opacity-70" : "bg-primary/5"}`}
											data-testid={`notif-${row.name}`}
										>
											<div className="mt-1 flex size-2 items-center justify-center">
												{!row.read ? (
													<span className="size-2 rounded-full bg-primary" aria-hidden />
												) : null}
											</div>
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm font-medium">{row.subject}</div>
												<div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
													<span>{timeAgo(row.creation)}</span>
													{row.document_type ? (
														<>
															<span>·</span>
															<span className="truncate">{row.document_type} {row.document_name}</span>
														</>
													) : null}
												</div>
											</div>
											<div className="flex flex-col items-end gap-1">
												{desk ? (
													<a
														href={desk}
														target="_blank"
														rel="noopener noreferrer"
														className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
														data-testid={`open-notif-${row.name}`}
														onClick={() => onMarkRead(row)}
													>
														Open <ExternalLink className="size-3" />
													</a>
												) : null}
												{!row.read ? (
													<Button
														variant="ghost"
														size="icon"
														className="size-6"
														aria-label="Mark read"
														onClick={() => onMarkRead(row)}
														data-testid={`mark-read-${row.name}`}
													>
														<Check className="size-3" />
													</Button>
												) : null}
											</div>
										</motion.li>
									);
								})}
							</motion.ul>
						</AnimatePresence>
					)}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
