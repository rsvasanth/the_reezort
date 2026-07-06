/**
 * RoomReadinessCard — read-only housekeeping readiness evidence for a room,
 * shown to front desk during check-in room assignment.
 *
 * Fetches get_room_readiness: the latest passed inspection (inspector,
 * timestamp, notes) plus its photos and the cleaning task's completion
 * photos. Photos open full-size in a new tab.
 */

import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getRoomReadiness, type RoomReadiness } from "@/lib/housekeeping-api";

function fmtDT(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso.replace(" ", "T"));
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function RoomReadinessCard({ room }: { room: string }) {
	const [readiness, setReadiness] = useState<RoomReadiness | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		getRoomReadiness(room)
			.then((env) => {
				if (!cancelled) setReadiness(env.data ?? null);
			})
			.catch(() => {
				if (!cancelled) setReadiness(null);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [room]);

	if (loading) return <Skeleton className="h-24 w-full" />;
	if (!readiness) return null;

	const inspection = readiness.inspection;

	return (
		<div className="rounded-lg border bg-muted/30 p-3" data-testid="room-readiness">
			<div className="flex flex-wrap items-center gap-2">
				{readiness.ready ? (
					<Badge className="gap-1 border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" variant="outline">
						<ShieldCheck className="size-3.5" /> {readiness.housekeeping_status}
					</Badge>
				) : (
					<Badge className="gap-1 border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" variant="outline">
						<ShieldAlert className="size-3.5" /> {readiness.housekeeping_status}
					</Badge>
				)}
				<span className="text-xs text-muted-foreground">
					{inspection
						? `Inspected by ${inspection.inspector_name ?? inspection.inspector_user ?? "—"} · ${fmtDT(inspection.inspected_at)} · ${inspection.inspection_status}`
						: "No inspection on record for this room yet."}
				</span>
			</div>

			{inspection?.notes ? (
				<p className="mt-1.5 text-xs text-muted-foreground">{inspection.notes}</p>
			) : null}

			{readiness.photos.length > 0 ? (
				<ul className="mt-2 flex flex-wrap gap-2">
					{readiness.photos.map((photo) => (
						<li key={`${photo.source}-${photo.image}`}>
							<a href={photo.image} target="_blank" rel="noreferrer" title={photo.caption || photo.source}>
								<img
									src={photo.image}
									alt={photo.caption || `${photo.source} photo`}
									className="size-16 rounded-md border object-cover"
								/>
							</a>
						</li>
					))}
				</ul>
			) : (
				<p className="mt-2 text-xs text-muted-foreground">No readiness photos yet — housekeeping attaches them at inspection.</p>
			)}
		</div>
	);
}
