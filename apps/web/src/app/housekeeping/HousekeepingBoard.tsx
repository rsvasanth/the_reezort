/**
 * HousekeepingBoard — full-screen housekeeping room board for resort staff.
 *
 * Pattern mirrors FolioWorkspace:
 *   - live-with-mock-fallback (network/5xx → show bundled mock, hide mutations)
 *   - 4xx API errors → error state with retry
 *   - loading skeletons while fetching
 *
 * Route: the caller wires <Route path="/housekeeping" element={<HousekeepingBoard />} />
 * No required props.
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { RefreshCw } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { WorkspacePage } from "@/components/workspace/workspace";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import {
	HousekeepingEmptyState,
	HousekeepingErrorState,
	HousekeepingLoadingState,
} from "@/components/housekeeping/housekeeping-states";
import { RoomGrid } from "@/components/housekeeping/room-grid";

import { FolioApiError, getHousekeepingBoard } from "@/lib/housekeeping-api";
import type { HousekeepingRoom } from "@/lib/housekeeping-api";

import mockData from "./mock.json";

type SnapshotState = "loading" | "live" | "mock" | "error";

export default function HousekeepingBoard() {
	const [rooms, setRooms] = useState<HousekeepingRoom[]>([]);
	const [snapshotState, setSnapshotState] = useState<SnapshotState>("loading");
	const [errorMessage, setErrorMessage] = useState<string>("");

	const load = useCallback(() => {
		setSnapshotState("loading");
		setErrorMessage("");

		getHousekeepingBoard()
			.then((envelope) => {
				if (envelope.ok && envelope.data) {
					setRooms(envelope.data.rooms);
					setSnapshotState("live");
					return;
				}
				if (envelope.blockers && envelope.blockers.length > 0) {
					setRooms([]);
					setErrorMessage(envelope.blockers.map((b) => b.message).join("; "));
					setSnapshotState("error");
					return;
				}
				setRooms([]);
				setErrorMessage("Unexpected response from the server.");
				setSnapshotState("error");
			})
			.catch((error: unknown) => {
				if (
					error instanceof FolioApiError &&
					error.status >= 400 &&
					error.status < 500
				) {
					setRooms([]);
					setErrorMessage(
						error.blockers.length > 0
							? error.blockers.map((b) => b.message).join("; ")
							: error.message
					);
					setSnapshotState("error");
					return;
				}
				// Network / 5xx — fall back to mock so the screen still renders.
				setRooms((mockData as { rooms: HousekeepingRoom[] }).rooms);
				setSnapshotState("mock");
			});
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const isMock = snapshotState === "mock";

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
				<WorkspacePage
					title="Housekeeping"
					subtitle="Room status, cleaning tasks and linen across the property."
					toolbar={
						<>
							<Badge variant="outline">
								{snapshotState === "live"
									? "Live board"
									: snapshotState === "loading"
										? "Loading board"
										: snapshotState === "mock"
											? "Mock board"
											: "Board error"}
							</Badge>
							{isMock && (
								<Badge variant="secondary" className="text-warning">
									Offline — showing demo data
								</Badge>
							)}
						</>
					}
					actions={
						<>
							{rooms.length > 0 ? (
								<Badge variant="secondary">{rooms.length} room{rooms.length === 1 ? "" : "s"}</Badge>
							) : null}
							{snapshotState !== "loading" && (
								<Button
									size="sm"
									variant="outline"
									onClick={load}
									disabled={snapshotState === "loading"}
								>
									<RefreshCw className="mr-2 size-4" />
									Refresh
								</Button>
							)}
						</>
					}
				>

					{/* Summary strip (only when data is present) */}
					{(snapshotState === "live" || snapshotState === "mock") && rooms.length > 0 && (
						<BoardSummaryStrip rooms={rooms} />
					)}

					{/* Main body */}
					<BoardBody
						snapshotState={snapshotState}
						rooms={rooms}
						errorMessage={errorMessage}
						isMock={isMock}
						onRetry={load}
						onMutated={load}
					/>
				</WorkspacePage>
			</SidebarInset>
		</SidebarProvider>
	);
}

// ---------- Summary strip ----------

function BoardSummaryStrip({ rooms }: { rooms: HousekeepingRoom[] }) {
	const counts = {
		dirty: rooms.filter((r) => r.housekeeping_status === "Dirty").length,
		inProgress: rooms.filter((r) => r.housekeeping_status === "In Progress").length,
		clean: rooms.filter((r) => r.housekeeping_status === "Clean").length,
		inspected: rooms.filter((r) => r.housekeeping_status === "Inspected").length,
		pickup: rooms.filter((r) => r.housekeeping_status === "Pickup").length,
		turndown: rooms.filter((r) => r.housekeeping_status === "Turndown Required").length,
		oos: rooms.filter((r) => r.housekeeping_status === "Out of Service Cleaning").length,
	};

	return (
		<div className="flex flex-wrap gap-2 text-sm">
			<SummaryChip label="Dirty" count={counts.dirty} className="bg-danger text-white" />
			<SummaryChip label="In Progress" count={counts.inProgress} className="bg-primary text-white" />
			<SummaryChip label="Pickup" count={counts.pickup} className="bg-chart-4 text-white" />
			<SummaryChip label="Turndown" count={counts.turndown} />
			<SummaryChip label="Clean" count={counts.clean} className="bg-success text-white" />
			<SummaryChip label="Inspected" count={counts.inspected} className="bg-chart-3 text-white" />
			{counts.oos > 0 && (
				<SummaryChip label="OOS Cleaning" count={counts.oos} className="bg-destructive text-white" />
			)}
		</div>
	);
}

function SummaryChip({
	label,
	count,
	className,
}: {
	label: string;
	count: number;
	className?: string;
}) {
	if (count === 0) return null;
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className ?? "bg-muted text-foreground"}`}
		>
			<span className="font-bold">{count}</span>
			{label}
		</span>
	);
}

// ---------- Body ----------

type BodyProps = {
	snapshotState: SnapshotState;
	rooms: HousekeepingRoom[];
	errorMessage: string;
	isMock: boolean;
	onRetry: () => void;
	onMutated: () => void;
};

function BoardBody({
	snapshotState,
	rooms,
	errorMessage,
	isMock,
	onRetry,
	onMutated,
}: BodyProps) {
	if (snapshotState === "loading") {
		return <HousekeepingLoadingState />;
	}

	if (snapshotState === "error") {
		return (
			<HousekeepingErrorState
				message={errorMessage || "Unknown error."}
				onRetry={onRetry}
			/>
		);
	}

	if (rooms.length === 0) {
		return <HousekeepingEmptyState />;
	}

	return <RoomGrid rooms={rooms} isMock={isMock} onMutated={onMutated} />;
}
