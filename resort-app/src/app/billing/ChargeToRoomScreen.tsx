/**
 * Charge to Room — department-facing incidental posting (spec 004). Any
 * department (spa, laundry, transport…) picks an in-house guest and posts a
 * charge straight to their folio, without opening the folio workspace.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, DoorClosed, Search, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { WorkspacePage } from "@/components/workspace/workspace";
import { formatCurrency } from "@/components/folio/folio-format";
import {
	FolioApiError,
	POSTING_DEPARTMENTS,
	listPostableRooms,
	postChargeToRoom,
	validateRoomPostingTarget,
	type PostableRoom,
	type RoomPostingTarget,
} from "@/lib/charge-to-room-api";

function reportError(error: unknown, fallback: string) {
	toast.error(fallback, { description: error instanceof FolioApiError ? error.message : String(error) });
}

export default function ChargeToRoomScreen() {
	const [search, setSearch] = useState("");
	const [rooms, setRooms] = useState<PostableRoom[]>([]);
	const [selected, setSelected] = useState<PostableRoom | null>(null);
	const [target, setTarget] = useState<RoomPostingTarget | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	const [department, setDepartment] = useState("Spa");
	const [description, setDescription] = useState("");
	const [amount, setAmount] = useState("");

	const reload = useCallback(async (q?: string) => {
		try {
			const data = await listPostableRooms(q);
			setRooms(data.rooms);
		} catch (error) {
			reportError(error, "Could not load in-house guests");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	async function pick(room: PostableRoom) {
		setSelected(room);
		setTarget(null);
		try {
			setTarget(await validateRoomPostingTarget(room.name));
		} catch (error) {
			reportError(error, "Could not check the folio");
		}
	}

	async function post() {
		if (!selected || !target?.stay) return;
		if (!description.trim()) {
			toast.error("Enter a description.");
			return;
		}
		const amt = Number(amount);
		if (!amt || amt <= 0) {
			toast.error("Enter an amount greater than zero.");
			return;
		}
		setBusy(true);
		try {
			const res = await postChargeToRoom({ stay: target.stay, description: description.trim(), amount: amt, department });
			toast.success("Charged to room", {
				description: `${formatCurrency(res.amount, "INR")} · ${res.guest_name ?? selected.current_room} · ${res.department}`,
			});
			setDescription("");
			setAmount("");
			void pick(selected); // refresh folio state
		} catch (error) {
			reportError(error, "Could not post the charge");
		} finally {
			setBusy(false);
		}
	}

	return (
		<WorkspacePage
			testId="charge-to-room-screen"
			badge="Billing"
			title="Charge to room"
			subtitle="Post a spa, laundry, or incidental charge straight to an in-house guest's folio."
		>
			<div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
				{/* In-house guest picker */}
				<div className="flex flex-col gap-3">
					<div className="flex gap-2">
						<Input
							placeholder="Search guest or room…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && reload(search)}
							data-testid="ctr-search"
						/>
						<Button variant="outline" size="icon" onClick={() => reload(search)} aria-label="Search">
							<Search className="size-4" />
						</Button>
					</div>
					<div className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
						{loading ? (
							<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" /> Loading…
							</div>
						) : rooms.length === 0 ? (
							<p className="py-6 text-center text-sm text-muted-foreground">No in-house guests.</p>
						) : (
							rooms.map((r) => (
								<button
									key={r.name}
									type="button"
									onClick={() => pick(r)}
									className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
										selected?.name === r.name ? "border-primary bg-primary/5" : "hover:bg-muted"
									}`}
									data-testid={`ctr-room-${r.name}`}
								>
									<span className="font-medium">{r.primary_guest_name ?? r.name}</span>
									<span className="flex items-center gap-1 text-muted-foreground">
										<DoorClosed className="size-3" /> {r.current_room ?? "—"}
									</span>
								</button>
							))
						)}
					</div>
				</div>

				{/* Posting form */}
				<div className="rounded-xl border p-5">
					{!selected ? (
						<div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
							Pick an in-house guest to post a charge.
						</div>
					) : (
						<div className="flex flex-col gap-4">
							<div className="flex items-center justify-between">
								<div>
									<h3 className="font-medium">{target?.guest_name ?? selected.primary_guest_name}</h3>
									<p className="text-xs text-muted-foreground">Room {selected.current_room ?? "—"}</p>
								</div>
								{target ? (
									<Badge variant={target.postable ? "secondary" : "destructive"}>
										{target.postable ? `Folio ${target.folio_status}` : target.reason ?? "Not postable"}
									</Badge>
								) : (
									<Loader2 className="size-4 animate-spin text-muted-foreground" />
								)}
							</div>

							<div className="flex flex-col gap-1.5">
								<Label>Department</Label>
								<Select value={department} onValueChange={setDepartment}>
									<SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
									<SelectContent>
										{POSTING_DEPARTMENTS.map((d) => (
											<SelectItem key={d} value={d}>{d}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="flex flex-col gap-1.5">
								<Label>Description</Label>
								<Input
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder="e.g. 60-min aromatherapy massage"
									data-testid="ctr-description"
								/>
							</div>

							<div className="flex flex-col gap-1.5">
								<Label>Amount (₹)</Label>
								<Input
									type="number"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									min={0}
									step={0.01}
									data-testid="ctr-amount"
								/>
							</div>

							<Button
								onClick={post}
								disabled={busy || !target?.postable}
								data-testid="ctr-post"
							>
								{busy ? <Loader2 className="size-4 animate-spin" /> : <ReceiptText className="size-4" />} Post to folio
							</Button>
						</div>
					)}
				</div>
			</div>
		</WorkspacePage>
	);
}
