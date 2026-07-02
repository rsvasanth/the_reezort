/**
 * FolioStayCard — compact stay + billing context for the settlement rail.
 *
 * Replaces FolioRoomHero: the villa photo shrinks from a full-width hero
 * to a 56px thumbnail, and the property/company/currency footer from the
 * old header card moves here. Renders even without a room so the billing
 * meta always has a home (Direct/Company folios).
 */

import { motion } from "motion/react";
import { BedDouble } from "lucide-react";

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

export function FolioStayCard({ folio }: { folio: GuestFolioHeader }) {
	const nights = nightsBetween(folio.arrival_date, folio.departure_date);
	const roomLabel = folio.room_number ?? folio.current_room;

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.35, ease: EASE_OUT }}
		>
			<Card>
				<CardContent className="p-5">
					<h3 className="font-display text-base font-normal">Stay</h3>
					{folio.current_room ? (
						<a
							href={`#/room/${encodeURIComponent(folio.current_room)}`}
							className="group mt-3 flex items-center gap-3"
							aria-label={`Open room ${folio.current_room}`}
						>
							<div className="size-14 shrink-0 overflow-hidden rounded-lg border">
								{folio.current_room_image ? (
									<img
										src={folio.current_room_image}
										alt={roomLabel ?? "Room"}
										className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
									/>
								) : (
									<div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
										<BedDouble className="size-5" />
									</div>
								)}
							</div>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm font-medium group-hover:underline">
										{roomLabel}
									</span>
									{folio.stay_status && (
										<Badge variant="secondary" className="text-[10px]">
											{folio.stay_status}
										</Badge>
									)}
								</div>
								<div className="mt-0.5 text-xs text-muted-foreground">
									{formatDate(folio.arrival_date)} → {formatDate(folio.departure_date)}
									{nights !== null && ` · ${nights} night${nights === 1 ? "" : "s"}`}
								</div>
							</div>
						</a>
					) : (
						<div className="mt-2 text-xs text-muted-foreground">No room linked to this folio.</div>
					)}
					<dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
						<MetaItem label="Property" value={folio.resort_property} />
						<MetaItem label="Currency" value={folio.currency} />
						<div className="col-span-2">
							<MetaItem label="Company" value={folio.company} />
						</div>
					</dl>
				</CardContent>
			</Card>
		</motion.div>
	);
}

function MetaItem({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</dt>
			<dd className="mt-0.5 truncate text-xs">{value}</dd>
		</div>
	);
}
