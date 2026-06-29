import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import { AddLineSheet } from "@/components/folio/add-line-sheet";
import { FolioHeaderCard } from "@/components/folio/folio-header-card";
import { FolioLinesTable } from "@/components/folio/folio-lines-table";
import { FolioTotalsStrip } from "@/components/folio/folio-totals-strip";
import { SettleFolioSheet } from "@/components/folio/settle-folio-sheet";
import {
	FolioErrorState,
	FolioLoadingState,
	FolioNoSelectionState,
	ReadOnlyBanner,
} from "@/components/folio/folio-states";

import { FolioApiError, getFolioDetail } from "@/lib/folio-api";
import type { FolioDetail } from "@/lib/folio-api";

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

	const load = useCallback(() => {
		if (!folioName) return;
		setSnapshotState("loading");
		setErrorMessage("");
		getFolioDetail(folioName)
			.then((envelope) => {
				if (envelope.ok && envelope.data) {
					setDetail(envelope.data);
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
			<SidebarInset>
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
}: {
	folioName: string | null;
	snapshotState: SnapshotState;
	detail: FolioDetail | null;
	errorMessage: string;
	onRetry: () => void;
	onBack: () => void;
	onAddLine: () => void;
	onSettle: () => void;
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

	const addLineVisible =
		!mutationsDisabled && (detail.next_actions ?? []).includes("add_line");

	return (
		<>
			{isReadOnly && <ReadOnlyBanner status={detail.folio.folio_status} />}
			<FolioHeaderCard
				detail={detail}
				mutationsDisabled={mutationsDisabled}
				onAddLine={onAddLine}
				onSettle={onSettle}
				onRefresh={onRetry}
			/>
			<FolioTotalsStrip
				totals={detail.totals}
				balanceStatus={detail.balance_status}
				currency={detail.folio.currency}
			/>
			<FolioLinesTable
				lines={detail.lines}
				currency={detail.folio.currency}
				showErpnextColumn={hasFinanceLink}
				emptyAddLineVisible={addLineVisible}
				onEmptyAddLine={onAddLine}
			/>
		</>
	);
}
