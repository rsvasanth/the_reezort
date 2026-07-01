/**
 * FolioRoomHero — compact stay-room card for the folio workspace.
 *
 * Shows the guest's assigned villa image alongside stay meta (room, arrival
 * → departure, nights). Renders only when the folio is linked to a Stay
 * with a current_room. Framer-motion fade-in.
 */

import { motion } from "motion/react";
import { BedDouble, CalendarRange } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EASE_OUT } from "@/lib/motion";
import type { GuestFolioHeader } from "@/lib/folio-api";

function nightsBetween(a: string | null | undefined, b: string | null | undefined): number | null {
	if (!a || !b) return null;
	const d1 = new Date(a).getTime();
	const d2 = new Date(b).getTime();
	if (Number.isNaN(d1) || Number.isNaN(d2)) return null;
	return Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
}

function formatDate(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(d);
}

export function FolioRoomHero({ folio }: { folio: GuestFolioHeader }) {
	if (!folio.current_room) return null;
	const nights = nightsBetween(folio.arrival_date, folio.departure_date);

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.35, ease: EASE_OUT }}
		>
			<Card className="overflow-hidden">
				<CardContent className="flex flex-col gap-0 p-0 md:flex-row">
					<a
						href={`#/room/${encodeURIComponent(folio.current_room)}`}
						className="group relative block h-40 w-full shrink-0 overflow-hidden md:h-auto md:w-64"
						aria-label={`Open room ${folio.current_room}`}
					>
						{folio.current_room_image ? (
							<img
								src={folio.current_room_image}
								alt={folio.room_number ?? folio.current_room}
								className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
							/>
						) : (
							<div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-200 to-stone-100 text-lg font-medium text-stone-600 dark:from-stone-800 dark:to-stone-900 dark:text-stone-300">
								{folio.room_number ?? folio.current_room}
							</div>
						)}
						<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
						<div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
							<BedDouble className="size-3" />
							{folio.room_number ?? folio.current_room}
						</div>
					</a>
					<div className="flex flex-1 flex-col justify-center gap-2 p-4">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium">{folio.room_number ?? folio.current_room}</span>
							{folio.stay_status ? (
								<Badge variant="secondary" className="text-[10px]">{folio.stay_status}</Badge>
							) : null}
						</div>
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
							<span className="inline-flex items-center gap-1">
								<CalendarRange className="size-3.5" />
								{formatDate(folio.arrival_date)} → {formatDate(folio.departure_date)}
							</span>
							{nights !== null ? <span>{nights} night{nights === 1 ? "" : "s"}</span> : null}
							{folio.guest_name ? <span>· {folio.guest_name}</span> : null}
						</div>
					</div>
				</CardContent>
			</Card>
		</motion.div>
	);
}
