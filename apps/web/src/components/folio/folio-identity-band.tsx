/**
 * FolioIdentityBand — guest identity + folio chips + lifecycle journey.
 *
 * Replaces FolioHeaderCard. The guest name is the editorial hero (display
 * serif); folio identity collapses into a chip row; the three cryptic
 * status badges become the FolioJourney stepper. Money actions live in
 * the settlement rail and the post bar — this band keeps only Check out
 * (the stay-level action) and the utility overflow menu.
 */

import {
	BedDouble,
	CalendarRange,
	Copy,
	FileDown,
	MoreHorizontal,
	Printer,
	RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { GuestAvatar } from "@/components/guest-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import type { FolioDetail } from "@/lib/folio-api";

import { deriveJourney, folioStatusBadge } from "./folio-format";
import { FolioJourney } from "./folio-journey";

const KNOWN_ACTIONS = new Set(["add_line", "open_settlement"]);

type Props = {
	detail: FolioDetail;
	onRefresh: () => void;
	onCheckOut: () => void;
	onDownloadInvoice: () => void;
	onPrintLabel: () => void;
	onPrintFarewell: () => void;
	checkingOut?: boolean;
	/**
	 * True when `detail` is not confirmed live data (e.g. a mock-fallback
	 * folio). Destructive/live actions — check out, invoice, farewell slip,
	 * stay label — must be disabled so a fabricated guest/stay can't be
	 * checked out or have documents printed against it.
	 */
	disableLiveActions?: boolean;
};

export function FolioIdentityBand({
	detail,
	onRefresh,
	onCheckOut,
	onDownloadInvoice,
	onPrintLabel,
	onPrintFarewell,
	checkingOut,
	disableLiveActions,
}: Props) {
	const { folio, next_actions } = detail;
	const actions = next_actions ?? [];
	const guestDisplayName = folio.guest_name ?? folio.customer_name ?? folio.customer;
	const journey = deriveJourney(folio.folio_status, folio.stay_status);
	const folioStyle = folioStatusBadge(folio.folio_status);

	// Once the folio is invoiced (settled or on credit), the guest can check out:
	// this frees the room and sends it to housekeeping. Hide the button after the
	// stay is already Checked Out so it can't be clicked twice.
	const showCheckOut =
		!!folio.stay
		&& ["Ready for Settlement", "Settled", "Closed"].includes(folio.folio_status)
		&& folio.stay_status !== "Checked Out"
		&& folio.stay_status !== "Cancelled";

	function copyFolioName() {
		navigator.clipboard
			.writeText(folio.name)
			.then(() => toast.success("Folio ID copied", { description: folio.name }))
			.catch(() => toast.error("Couldn't copy to clipboard"));
	}

	return (
		<div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
			<div className="flex min-w-0 items-start gap-4">
				<GuestAvatar
					name={guestDisplayName}
					imageUrl={folio.guest_image}
					size="lg"
					className="ring-1 ring-brass/40"
				/>
				<div className="min-w-0">
					<h1 className="truncate font-display text-3xl font-light tracking-tight">
						{guestDisplayName}
					</h1>
					<div className="mt-2 flex flex-wrap items-center gap-1.5">
						<Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
							{folio.folio_type} folio
							{folio.primary_folio === 1 && <span className="text-brass">· Primary</span>}
						</Badge>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={copyFolioName}
										className="group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
									>
										{folio.name}
										<Copy className="size-3 opacity-50 group-hover:opacity-100" />
									</button>
								</TooltipTrigger>
								<TooltipContent>Copy folio ID</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						{folio.reservation && (
							<Badge variant="outline" className="gap-1 font-mono text-[11px] font-normal text-muted-foreground">
								<CalendarRange className="size-3" />
								{folio.reservation}
							</Badge>
						)}
						{folio.room_number && (
							<Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
								<BedDouble className="size-3" />
								{folio.room_number}
							</Badge>
						)}
					</div>
				</div>
			</div>

			<div className="flex flex-col items-end gap-3">
				<div className="flex items-center gap-2">
					{showCheckOut && (
						<Button
							size="sm"
							onClick={onCheckOut}
							disabled={checkingOut || disableLiveActions}
							title={disableLiveActions ? "Unavailable while showing unconfirmed data" : undefined}
							data-testid="folio-checkout"
						>
							{checkingOut ? "Checking out…" : "Check out"}
						</Button>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm" variant="ghost" aria-label="More actions">
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={onRefresh}>
								<RefreshCw className="mr-2 size-4" />
								Refresh
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={onDownloadInvoice}
								disabled={disableLiveActions}
								onSelect={disableLiveActions ? (event) => event.preventDefault() : undefined}
							>
								<FileDown className="mr-2 size-4" />
								Download tax invoice (GST)
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={onPrintFarewell}
								disabled={disableLiveActions}
								onSelect={disableLiveActions ? (event) => event.preventDefault() : undefined}
							>
								<Printer className="mr-2 size-4" />
								Print farewell slip (A6)
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={onPrintLabel}
								disabled={disableLiveActions}
								onSelect={disableLiveActions ? (event) => event.preventDefault() : undefined}
							>
								<Printer className="mr-2 size-4" />
								Print stay label (QR)
							</DropdownMenuItem>
							{actions.some((a) => !KNOWN_ACTIONS.has(a)) && <DropdownMenuSeparator />}
							{/* Forward-compat: unknown next_actions surface here as muted chips */}
							{actions
								.filter((a) => !KNOWN_ACTIONS.has(a))
								.map((action) => (
									<DropdownMenuItem
										key={action}
										disabled
										onSelect={(event) => event.preventDefault()}
									>
										<span className="font-mono text-xs">{action}</span>
										<span className="ml-2 text-xs text-muted-foreground">pending UI</span>
									</DropdownMenuItem>
								))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				{journey ? (
					<FolioJourney steps={journey} />
				) : (
					<Badge variant={folioStyle.variant} className={folioStyle.className}>
						{folio.folio_status}
					</Badge>
				)}
			</div>
		</div>
	);
}
