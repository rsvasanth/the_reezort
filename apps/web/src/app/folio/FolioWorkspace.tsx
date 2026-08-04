import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import { AddLineSheet } from "@/components/folio/add-line-sheet";
import { FolioIdentityBand } from "@/components/folio/folio-identity-band";
import { FolioLinesTable } from "@/components/folio/folio-lines-table";
import { FolioPostBar } from "@/components/folio/folio-post-bar";
import { FolioSettlementRail } from "@/components/folio/folio-settlement-rail";
import { FolioStayCard } from "@/components/folio/folio-stay-card";
import { SettleFolioSheet } from "@/components/folio/settle-folio-sheet";
import { DepositSheet } from "@/components/folio/deposit-sheet";
import { IrdOrderSheet } from "@/components/folio/ird-order-sheet";
import { MinibarSheet } from "@/components/folio/minibar-sheet";
import {
	FolioErrorState,
	FolioLoadingState,
	FolioNoSelectionState,
	ReadOnlyBanner,
} from "@/components/folio/folio-states";

import { toast } from "sonner";

import { FolioApiError, getFolioDetail } from "@/lib/folio-api";
import type { FolioDetail } from "@/lib/folio-api";
import { checkOut } from "@/lib/pms-api";

import mockFolio from "./mock.json";

type SnapshotState = "loading" | "live" | "mock" | "error";

const READ_ONLY_STATUSES = new Set(["Closed", "Cancelled", "Settled", "Transferred"]);

type Props = {
	folioName: string | null;
};

export function FolioWorkspace({ folioName }: Props) {
	const [detail, setDetail] = useState<FolioDetail | null>(null);
	const [snapshotState, setSnapshotState] = useState<SnapshotState>("loading");
	const [errorMessage, setErrorMessage] = useState<string>("");
	const [addLineOpen, setAddLineOpen] = useState(false);
	const [settleOpen, setSettleOpen] = useState(false);
	const [depositOpen, setDepositOpen] = useState(false);
	const [minibarOpen, setMinibarOpen] = useState(false);
	const [irdOpen, setIrdOpen] = useState(false);
	const [checkingOut, setCheckingOut] = useState(false);

	const load = useCallback(() => {
		if (!folioName) return;
		setSnapshotState("loading");
		setErrorMessage("");
		getFolioDetail(folioName)
			.then((envelope) => {
				if (envelope.ok && envelope.data) {
					// next_actions lives at the envelope level, not inside data — merge it
					// in so action gating (Settle / Add line) sees it.
					setDetail({ ...envelope.data, next_actions: envelope.next_actions ?? [] });
					setSnapshotState("live");
					return;
				}
				if (envelope.blockers && envelope.blockers.length > 0) {
					setDetail(null);
					setErrorMessage(envelope.blockers.map((b) => b.message).join("; "));
					setSnapshotState("error");
					return;
				}
				setDetail(null);
				setErrorMessage("Unexpected response from the server.");
				setSnapshotState("error");
			})
			.catch((error: unknown) => {
				if (error instanceof FolioApiError && error.status >= 400 && error.status < 500) {
					setDetail(null);
					setErrorMessage(
						error.blockers.length > 0
							? error.blockers.map((b) => b.message).join("; ")
							: error.message
					);
					setSnapshotState("error");
					return;
				}
				// Network / 5xx: fall back to mock so the screen renders something.
				setDetail(mockFolio as unknown as FolioDetail);
				setSnapshotState("mock");
			});
	}, [folioName]);

	useEffect(() => {
		load();
	}, [load]);

	function navigateBack() {
		window.location.hash = "#/";
	}

	async function handleCheckOut() {
		const stay = detail?.folio.stay;
		if (!stay) return;
		setCheckingOut(true);
		try {
			const result = await checkOut(stay);
			toast.success("Checked out", {
				description: result.housekeeping_task
					? `Room ${result.room} freed and sent to housekeeping`
					: `Stay ${stay} checked out`,
				action: {
					label: "Print farewell slip",
					onClick: () => { void handlePrintFarewell(); },
				},
				duration: 10000,
			});
			load();
		} catch (error) {
			const message = error instanceof FolioApiError ? error.message : String(error);
			toast.error("Checkout failed", { description: message });
		} finally {
			setCheckingOut(false);
		}
	}

	async function handlePrintFarewell() {
		if (!detail) return;
		try {
			const { printFarewellSlip } = await import("@/lib/farewell-slip");
			const { fetchInvoiceBundle } = await import("@/lib/tax-invoice");
			const bundle = await fetchInvoiceBundle(detail.folio.name);
			const inv = bundle.invoices[0];
			const nights =
				bundle.stay?.arrival_date && bundle.stay?.departure_date
					? Math.max(
							1,
							Math.round(
								(new Date(bundle.stay.departure_date).getTime() - new Date(bundle.stay.arrival_date).getTime()) /
									(1000 * 60 * 60 * 24),
							),
						)
					: null;
			await printFarewellSlip({
				folio: {
					name: detail.folio.name,
					currency: detail.folio.currency,
					total_charges: detail.totals.total_charges,
					total_paid: detail.totals.total_paid,
				},
				invoice: inv
					? { name: inv.name, grand_total: inv.rounded_total || inv.grand_total, posting_date: inv.posting_date }
					: null,
				guest: {
					name: bundle.guest_profile?.guest_full_name ?? detail.folio.customer_name ?? detail.folio.customer,
					email: bundle.guest_profile?.email ?? null,
					phone: bundle.guest_profile?.phone ?? null,
				},
				stay: {
					current_room: bundle.stay?.current_room ?? detail.folio.current_room ?? null,
					arrival_date: bundle.stay?.arrival_date ?? detail.folio.arrival_date ?? null,
					departure_date: bundle.stay?.departure_date ?? detail.folio.departure_date ?? null,
					nights,
				},
				property: detail.folio.resort_property,
				company: detail.folio.company,
				timestamp: new Date().toISOString(),
			});
			toast.success("Farewell slip generated");
		} catch (error) {
			toast.error("Could not print farewell slip", { description: error instanceof Error ? error.message : undefined });
		}
	}

	async function handleDownloadInvoice() {
		if (!detail) return;
		try {
			const { printGuestTaxInvoice, fetchInvoiceBundle } = await import("@/lib/tax-invoice");
			const bundle = await fetchInvoiceBundle(detail.folio.name);
			await printGuestTaxInvoice(bundle);
			toast.success("Tax Invoice PDF generated");
		} catch (error) {
			toast.error("Could not generate invoice", { description: error instanceof Error ? error.message : undefined });
		}
	}

	async function handlePrintLabel() {
		if (!detail) return;
		try {
			const { printStayLabel } = await import("@/lib/print-label");
			const { getReservation } = await import("@/lib/reservation-api");
			// Grab reservation-side context for booking source. Non-fatal if it fails.
			let reservation = { name: detail.folio.reservation ?? "—", status: "—", booking_source: null as string | null };
			if (detail.folio.reservation) {
				try {
					const r = await getReservation(detail.folio.reservation);
					reservation = { name: r.reservation, status: r.status, booking_source: r.booking_source };
				} catch { /* non-fatal */ }
			}
			const isCheckedOut = detail.folio.stay_status === "Checked Out";
			await printStayLabel({
				type: isCheckedOut ? "CHECKOUT" : "CHECKIN",
				folio: {
					name: detail.folio.name,
					total_charges: detail.totals.total_charges,
					total_taxes_estimated: detail.totals.total_taxes_estimated,
					total_paid: detail.totals.total_paid,
					outstanding_amount: detail.totals.outstanding_amount,
					currency: detail.folio.currency,
					folio_status: detail.folio.folio_status,
				},
				stay: {
					name: detail.folio.stay ?? null,
					stay_status: detail.folio.stay_status ?? null,
					current_room: detail.folio.current_room ?? null,
					arrival_date: detail.folio.arrival_date ?? null,
					departure_date: detail.folio.departure_date ?? null,
				},
				reservation,
				guest: {
					name: detail.folio.guest_name ?? detail.folio.customer_name ?? detail.folio.customer,
					email: null,
					phone: null,
				},
				property: detail.folio.resort_property,
				company: detail.folio.company,
				timestamp: new Date().toISOString(),
			});
			toast.success("Label PDF generated");
		} catch (error) {
			toast.error("Could not print label", { description: error instanceof Error ? error.message : undefined });
		}
	}

	return (
		<SidebarProvider
			style={
				{
					"--sidebar-width": "18rem",
					"--header-height": "3rem",
				} as CSSProperties
			}
		>
			<AppSidebar />
			<SidebarInset className="bg-transparent">
				<SiteHeader />
				<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<Badge variant="outline">
							{snapshotState === "live"
								? "Live folio"
								: snapshotState === "loading"
									? "Loading folio"
									: snapshotState === "mock"
										? "Mock folio"
										: "Folio error"}
						</Badge>
						<Badge variant="secondary">Folio Workspace</Badge>
					</div>

					<BodyContent
						folioName={folioName}
						snapshotState={snapshotState}
						detail={detail}
						errorMessage={errorMessage}
						onRetry={load}
						onBack={navigateBack}
						onAddLine={() => setAddLineOpen(true)}
						onSettle={() => setSettleOpen(true)}
						onDeposit={() => setDepositOpen(true)}
						onMinibar={() => setMinibarOpen(true)}
						onIrd={() => setIrdOpen(true)}
						onCheckOut={handleCheckOut}
						onDownloadInvoice={handleDownloadInvoice}
						onPrintLabel={handlePrintLabel}
						onPrintFarewell={handlePrintFarewell}
						checkingOut={checkingOut}
					/>
				</main>

				{detail && snapshotState !== "mock" && (
					<>
						<AddLineSheet
							open={addLineOpen}
							folioName={detail.folio.name}
							currency={detail.folio.currency}
							onClose={() => setAddLineOpen(false)}
							onLineAdded={() => load()}
						/>
						<SettleFolioSheet
							open={settleOpen}
							folioName={detail.folio.name}
							currency={detail.folio.currency}
							outstandingAmount={detail.totals?.outstanding_amount ?? 0}
							onClose={() => setSettleOpen(false)}
							onSettled={() => load()}
						/>
						<DepositSheet
							open={depositOpen}
							folioName={detail.folio.name}
							currency={detail.folio.currency}
							onClose={() => setDepositOpen(false)}
							onRecorded={() => load()}
						/>
						{detail.folio.stay ? (
							<>
								<MinibarSheet
									open={minibarOpen}
									onOpenChange={setMinibarOpen}
									stay={detail.folio.stay}
									roomLabel={detail.folio.room_number || detail.folio.current_room || undefined}
									guestName={detail.folio.guest_name || detail.folio.customer_name || null}
									resortProperty={detail.folio.resort_property}
									onPosted={() => load()}
								/>
								<IrdOrderSheet
									open={irdOpen}
									onOpenChange={setIrdOpen}
									stay={detail.folio.stay}
									roomLabel={detail.folio.room_number || detail.folio.current_room || undefined}
									guestName={detail.folio.guest_name || detail.folio.customer_name || null}
									resortProperty={detail.folio.resort_property}
									onPosted={() => load()}
								/>
							</>
						) : null}
					</>
				)}
			</SidebarInset>
		</SidebarProvider>
	);
}

function BodyContent({
	folioName,
	snapshotState,
	detail,
	errorMessage,
	onRetry,
	onBack,
	onAddLine,
	onSettle,
	onDeposit,
	onMinibar,
	onIrd,
	onCheckOut,
	onDownloadInvoice,
	onPrintLabel,
	onPrintFarewell,
	checkingOut,
}: {
	folioName: string | null;
	snapshotState: SnapshotState;
	detail: FolioDetail | null;
	errorMessage: string;
	onRetry: () => void;
	onBack: () => void;
	onAddLine: () => void;
	onSettle: () => void;
	onDeposit: () => void;
	onMinibar: () => void;
	onIrd: () => void;
	onPrintLabel: () => void;
	onPrintFarewell: () => void;
	onDownloadInvoice: () => void;
	onCheckOut: () => void;
	checkingOut: boolean;
}) {
	if (!folioName) {
		return <FolioNoSelectionState onBack={onBack} />;
	}

	if (snapshotState === "loading") {
		return <FolioLoadingState />;
	}

	if (snapshotState === "error" || !detail) {
		return (
			<FolioErrorState
				message={errorMessage || "Unknown error."}
				onRetry={onRetry}
				onBack={onBack}
			/>
		);
	}

	const isReadOnly = READ_ONLY_STATUSES.has(detail.folio.folio_status);
	// Per spec §7.4: hide all mutations in mock mode.
	const mutationsDisabled = isReadOnly || snapshotState === "mock";
	const hasFinanceLink = detail.lines.some(
		(line) =>
			line.erpnext_sales_invoice ||
			line.erpnext_payment_entry ||
			line.erpnext_credit_note ||
			line.erpnext_journal_entry
	);

	const actions = detail.next_actions ?? [];
	const addLineVisible = !mutationsDisabled && actions.includes("add_line");
	const settleVisible = !mutationsDisabled && actions.includes("open_settlement");
	// Tax invoice is available once a Sales Invoice exists (posting_status posted
	// or folio invoiced).
	const invoiceVisible =
		detail.posting_status === "Posted" ||
		["Ready for Settlement", "Settled", "Closed"].includes(detail.folio.folio_status);

	return (
		<>
			{isReadOnly && <ReadOnlyBanner status={detail.folio.folio_status} />}
			<FolioIdentityBand
				detail={detail}
				onRefresh={onRetry}
				onCheckOut={onCheckOut}
				onDownloadInvoice={onDownloadInvoice}
				onPrintLabel={onPrintLabel}
				onPrintFarewell={onPrintFarewell}
				checkingOut={checkingOut}
			/>
			<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
				<div className="flex min-w-0 flex-col gap-4">
					<FolioPostBar
						canAddLine={addLineVisible}
						canDeposit={!mutationsDisabled}
						canOrder={!mutationsDisabled && !!detail.folio.stay}
						canMinibar={!mutationsDisabled && !!detail.folio.stay}
						onAddLine={onAddLine}
						onDeposit={onDeposit}
						onOrder={onIrd}
						onMinibar={onMinibar}
					/>
					<FolioLinesTable
						lines={detail.lines}
						currency={detail.folio.currency}
						showErpnextColumn={hasFinanceLink}
						emptyAddLineVisible={addLineVisible}
						onEmptyAddLine={onAddLine}
						onLineCorrected={onRetry}
					/>
				</div>
				<div className="flex flex-col gap-4">
					<FolioSettlementRail
						totals={detail.totals}
						balanceStatus={detail.balance_status}
						postingStatus={detail.posting_status}
						currency={detail.folio.currency}
						lines={detail.lines}
						showSettle={settleVisible}
						showInvoice={invoiceVisible}
						onSettle={onSettle}
						onDownloadInvoice={onDownloadInvoice}
					/>
					<FolioStayCard folio={detail.folio} />
				</div>
			</div>
		</>
	);
}
