/**
 * FolioJourney — the folio lifecycle rendered as a compact stepper.
 *
 * Replaces the unlabeled folio_status badge stack: one glance tells the
 * agent where this folio sits between Open and Closed. Cancelled and
 * Transferred folios don't fit a linear journey and render as a plain
 * status badge instead (handled by the caller via deriveJourney → null).
 */

import { cn } from "@/lib/utils";

import type { JourneyStep } from "./folio-format";

export function FolioJourney({ steps }: { steps: JourneyStep[] }) {
	return (
		<div className="flex items-center" aria-label="Folio journey">
			{steps.map((step, i) => (
				<div key={step.label} className="flex items-center">
					{i > 0 && <div className="mx-2 h-px w-5 bg-border/60" />}
					<div
						className={cn(
							"flex items-center gap-1.5 text-[11px]",
							step.state === "done" && "text-muted-foreground",
							step.state === "current" && "font-semibold text-brass",
							step.state === "todo" && "text-muted-foreground/50"
						)}
					>
						<span
							className={cn(
								"size-[7px] rounded-full border",
								step.state === "done" && "border-muted-foreground bg-muted-foreground",
								step.state === "current" && "border-brass bg-brass ring-[3px] ring-brass/20",
								step.state === "todo" && "border-muted-foreground/40 bg-transparent"
							)}
						/>
						{step.label}
					</div>
				</div>
			))}
		</div>
	);
}
