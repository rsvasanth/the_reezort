/**
 * Self-service "My day" clock — visible in the site header for every staff role.
 * One tap clocks the current user IN or OUT (no manager required). Hides itself
 * for users with no linked Employee record (Administrator, system roles).
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMyDay, selfClockIn, selfClockOut, type MyDay } from "@/lib/staff-api";

function timeOnly(iso: string | null): string {
	if (!iso) return "";
	const m = iso.match(/(\d{2}:\d{2})/);
	return m ? m[1] : "";
}

export function MyDayClock() {
	const [day, setDay] = useState<MyDay | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setDay(await getMyDay());
		} catch {
			// Endpoint may not exist on older bundles; render nothing.
			setDay(null);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// No linked employee → nothing to clock. Hide the widget.
	if (!day || !day.employee) return null;

	const inNow = day.clocked === "IN";

	async function toggle() {
		setBusy(true);
		try {
			if (inNow) {
				await selfClockOut();
				toast.success("Clocked out");
			} else {
				await selfClockIn();
				toast.success("Clocked in");
			}
			await refresh();
		} catch (error) {
			toast.error("Could not record clock event", {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="hidden items-center gap-2 md:flex">
			{day.open_tasks > 0 ? (
				<Badge variant="secondary" data-testid="my-open-tasks">
					{day.open_tasks} task{day.open_tasks > 1 ? "s" : ""}
				</Badge>
			) : null}
			<Button
				size="sm"
				variant={inNow ? "outline" : "default"}
				disabled={busy}
				onClick={toggle}
				data-testid="my-day-clock"
				title={day.last_time ? `Last: ${day.clocked} · ${timeOnly(day.last_time)}` : undefined}
			>
				{busy ? <Loader2 className="size-4 animate-spin" /> : inNow ? <LogOut className="size-4" /> : <LogIn className="size-4" />}
				{inNow ? `Clock out · ${timeOnly(day.last_time)}` : "Clock in"}
			</Button>
		</div>
	);
}
