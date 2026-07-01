import {
	BedDouble,
	Building2,
	CalendarRange,
	Copy,
	FileDown,
	IdCard,
	MoreHorizontal,
	Printer,
	RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { GuestAvatar } from "@/components/guest-avatar";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import type { FolioDetail } from "@/lib/folio-api";

import {
	balanceStatusBadge,
	folioStatusBadge,
	postingStatusBadge,
} from "./folio-format";

type Props = {
	detail: FolioDetail;
	mutationsDisabled: boolean;
	onAddLine: () => void;
	onSettle: () => void;
	onDeposit: () => void;
	onRefresh: () => void;
	onCheckOut: () => void;
	onDownloadInvoice: () => void;
	onPrintLabel: () => void;
	checkingOut?: boolean;
};

export function FolioHeaderCard({
	detail,
	mutationsDisabled,
	onAddLine,
	onSettle,
	onDeposit,
	onRefresh,
	onCheckOut,
	onDownloadInvoice,
	onPrintLabel,
	checkingOut,
}: Props) {
	const { folio, balance_status, posting_status, next_actions } = detail;
	const actions = next_actions ?? [];

	const folioStyle = folioStatusBadge(folio.folio_status);
	const postingStyle = posting_status ? postingStatusBadge(posting_status) : null;
	const balanceStyle = balance_status ? balanceStatusBadge(balance_status) : null;

	const showAddLine = !mutationsDisabled && actions.includes("add_line");
	const showSettle = !mutationsDisabled && actions.includes("open_settlement");
	// Once the folio is invoiced (settled or on credit), the guest can check out:
	// this frees the room and sends it to housekeeping. Hide the button after the
	// stay is already Checked Out so it can't be clicked twice.
	const showCheckOut =
		!!folio.stay
		&& ["Ready for Settlement", "Settled", "Closed"].includes(folio.folio_status)
		&& folio.stay_status !== "Checked Out"
		&& folio.stay_status !== "Cancelled";
	// Tax invoice is available once a Sales Invoice exists (posting_status posted or
	// folio invoiced). Shown as the primary green CTA once the guest can pay.
	const showInvoice = posting_status === "Posted" || ["Ready for Settlement", "Settled", "Closed"].includes(folio.folio_status);

	function copyFolioName() {
		navigator.clipboard
			.writeText(folio.name)
			.then(() => toast.success("Folio ID copied", { description: folio.name }))
			.catch(() => toast.error("Couldn't copy to clipboard"));
	}

	const folioTypeVariant: "default" | "secondary" | "outline" =
		folio.folio_type === "Guest"
			? "default"
			: folio.folio_type === "Company" || folio.folio_type === "Travel Agent" || folio.folio_type === "Direct"
				? "secondary"
				: "outline";

	return (
		<Card>
			<CardContent className="p-6">
				<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
					{/* Guest / payer block */}
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
							<GuestAvatar
								name={folio.guest_name ?? folio.customer_name ?? folio.customer}
								imageUrl={folio.guest_image}
								size="lg"
							/>
							<span className="truncate">{folio.guest_name ?? folio.customer_name ?? folio.customer}</span>
						</div>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
							{folio.reservation && (
								<span className="inline-flex items-center gap-1">
									<CalendarRange className="size-3.5" />
									{folio.reservation}
								</span>
							)}
							{folio.stay && (
								<span className="inline-flex items-center gap-1">
									<BedDouble className="size-3.5" />
									{folio.stay}
								</span>
							)}
							{folio.room_number && (
								<span className="inline-flex items-center gap-1">
									<Building2 className="size-3.5" />
									Room {folio.room_number}
								</span>
							)}
						</div>
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<IdCard className="size-3.5" />
							<span>{folio.customer_name ?? folio.customer}</span>
						</div>
					</div>

					{/* Folio identity + actions block */}
					<div className="flex flex-col gap-2">
						<div className="flex flex-wrap items-center gap-2">
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={copyFolioName}
											className="group inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground transition hover:bg-muted"
										>
											{folio.name}
											<Copy className="size-3 opacity-50 group-hover:opacity-100" />
										</button>
									</TooltipTrigger>
									<TooltipContent>Copy folio ID</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							<Badge variant={folioTypeVariant}>{folio.folio_type}</Badge>
							{folio.primary_folio === 1 && <Badge variant="outline">Primary</Badge>}
						</div>
						<div className="flex flex-wrap gap-2">
							{showAddLine && (
								<Button size="sm" onClick={onAddLine}>
									Add Line
								</Button>
							)}
							{!mutationsDisabled && (
								<Button size="sm" variant="outline" onClick={onDeposit} data-testid="folio-deposit">
									Deposit
								</Button>
							)}
							{showSettle && (
								<Button size="sm" variant="outline" onClick={onSettle}>
									Prepare Settlement
								</Button>
							)}
							{showInvoice && (
								<Button size="sm" variant="default" onClick={onDownloadInvoice} data-testid="folio-download-invoice">
									<FileDown className="mr-1 size-4" /> Download tax invoice
								</Button>
							)}
							{showCheckOut && (
								<Button size="sm" onClick={onCheckOut} disabled={checkingOut} data-testid="folio-checkout">
									{checkingOut ? "Checking out…" : "Check out"}
								</Button>
							)}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button size="sm" variant="ghost">
										<MoreHorizontal className="size-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={onRefresh}>
										<RefreshCw className="mr-2 size-4" />
										Refresh
									</DropdownMenuItem>
									<DropdownMenuItem onClick={onDownloadInvoice}>
										<FileDown className="mr-2 size-4" />
										Download tax invoice (GST)
									</DropdownMenuItem>
									<DropdownMenuItem onClick={onPrintLabel}>
										<Printer className="mr-2 size-4" />
										Print stay label (QR)
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									{/* Forward-compat: unknown next_actions surface here as muted chips */}
									{actions
										.filter((a) => a !== "add_line" && a !== "open_settlement")
										.map((action) => (
											<DropdownMenuItem
												key={action}
												disabled
												onSelect={(event) => event.preventDefault()}
											>
												<span className="font-mono text-xs">{action}</span>
												<span className="ml-2 text-xs text-muted-foreground">
													pending UI
												</span>
											</DropdownMenuItem>
										))}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>

					{/* Status badges block (right-aligned vertical stack) */}
					<div className="flex flex-col items-start gap-2 lg:items-end">
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Badge variant={folioStyle.variant} className={folioStyle.className}>
										{folio.folio_status}
									</Badge>
								</TooltipTrigger>
								<TooltipContent>Folio status</TooltipContent>
							</Tooltip>
							{postingStyle && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Badge variant={postingStyle.variant} className={postingStyle.className}>
											{posting_status}
										</Badge>
									</TooltipTrigger>
									<TooltipContent>
										{posting_status === "Failed"
											? "ERPNext posting failed — retry available"
											: "ERPNext posting status"}
									</TooltipContent>
								</Tooltip>
							)}
							{balanceStyle && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Badge variant={balanceStyle.variant} className={balanceStyle.className}>
											{balance_status}
										</Badge>
									</TooltipTrigger>
									<TooltipContent>Balance status</TooltipContent>
								</Tooltip>
							)}
						</TooltipProvider>
					</div>
				</div>
				<Separator className="mt-6" />
				<div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
					<span>Property</span>
					<span className="font-medium text-foreground">{folio.resort_property}</span>
					<span>·</span>
					<span>Company</span>
					<span className="font-medium text-foreground">{folio.company}</span>
					<span>·</span>
					<span>Currency</span>
					<span className="font-medium text-foreground">{folio.currency}</span>
				</div>
			</CardContent>
		</Card>
	);
}
