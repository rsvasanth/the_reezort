/**
 * POS settle sheet — real payment flow for a walk-in restaurant order.
 * Split across cash / card / UPI / bank transfer, pay by card·UPI via Razorpay,
 * or charge the whole bill to an in-house guest's room. Captures the walk-in
 * guest name too.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

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
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FolioApiError } from "@/lib/folio-api";
import { formatINR } from "@/components/fnb/menu-visuals";
import {
	closeWalkIn,
	listInHouseStays,
	payWalkInViaRazorpay,
	postOrderToRoom,
	setOrderGuest,
	type InHouseStay,
	type RestaurantOrder,
} from "@/lib/restaurant-api";

const PAYMENT_MODES = ["Cash", "Card", "UPI", "Bank Transfer"];

type PayRow = { id: number; mode: string; amount: string };

function errMessage(error: unknown): string {
	return error instanceof FolioApiError
		? error.blockers[0]?.message ?? error.message
		: String(error);
}

export function SettlePaymentSheet({
	order,
	open,
	onOpenChange,
	onSettled,
}: {
	order: RestaurantOrder;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSettled: (order: RestaurantOrder) => void;
}) {
	const total = order.grand_total;
	const [busy, setBusy] = useState(false);
	const [guestName, setGuestName] = useState(order.guest_name ?? "");
	const [rows, setRows] = useState<PayRow[]>([{ id: 1, mode: "Cash", amount: String(total) }]);

	// Charge-to-room state
	const [staySearch, setStaySearch] = useState("");
	const [stays, setStays] = useState<InHouseStay[]>([]);
	const [pickedStay, setPickedStay] = useState<InHouseStay | null>(null);

	useEffect(() => {
		if (open) {
			setGuestName(order.guest_name ?? "");
			setRows([{ id: 1, mode: "Cash", amount: String(order.grand_total) }]);
			setPickedStay(null);
			setStaySearch("");
		}
	}, [open, order.guest_name, order.grand_total]);

	const paid = useMemo(
		() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
		[rows],
	);
	const balance = Math.round((total - paid) * 100) / 100;

	async function saveGuestIfChanged() {
		if (guestName.trim() && guestName.trim() !== (order.guest_name ?? "")) {
			try {
				await setOrderGuest(order.name, guestName.trim());
			} catch {
				/* non-fatal — settlement proceeds */
			}
		}
	}

	async function settleManual() {
		if (paid <= 0) {
			toast.error("Enter a payment amount.");
			return;
		}
		setBusy(true);
		try {
			await saveGuestIfChanged();
			const res = await closeWalkIn(
				order.name,
				rows.filter((r) => Number(r.amount) > 0).map((r) => ({ mode_of_payment: r.mode, amount: Number(r.amount) })),
			);
			toast.success("Bill settled", { description: res.sales_invoice });
			onSettled(res.order);
			onOpenChange(false);
		} catch (error) {
			toast.error("Could not settle", { description: errMessage(error) });
		} finally {
			setBusy(false);
		}
	}

	async function settleRazorpay() {
		setBusy(true);
		try {
			await saveGuestIfChanged();
			const res = await payWalkInViaRazorpay({ order: order.name, guestName: guestName || order.guest_name });
			toast.success("Paid by card / UPI", { description: "Razorpay payment captured." });
			onSettled(res.order);
			onOpenChange(false);
		} catch (error) {
			const msg = errMessage(error);
			if (msg.toLowerCase().includes("cancel")) toast.info("Payment cancelled");
			else toast.error("Card / UPI payment failed", { description: msg });
		} finally {
			setBusy(false);
		}
	}

	async function searchStays() {
		try {
			const res = await listInHouseStays(staySearch.trim() || undefined);
			setStays(res.stays);
		} catch (error) {
			toast.error("Could not load in-house guests", { description: errMessage(error) });
		}
	}

	useEffect(() => {
		if (open) void searchStays();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	async function chargeToRoom() {
		if (!pickedStay) {
			toast.error("Pick an in-house guest first.");
			return;
		}
		setBusy(true);
		try {
			const res = await postOrderToRoom(order.name, pickedStay.name);
			toast.success("Charged to room", {
				description: `${pickedStay.primary_guest_name ?? pickedStay.name} · folio ${res.guest_folio}`,
			});
			onSettled(res.order);
			onOpenChange(false);
		} catch (error) {
			toast.error("Could not charge to room", { description: errMessage(error) });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
				<SheetHeader>
					<SheetTitle>Settle bill · {formatINR(total)}</SheetTitle>
					<SheetDescription>{order.kot_number ?? order.name}</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-4 overflow-y-auto p-4">
					<div className="flex flex-col gap-1">
						<Label>Guest name (optional)</Label>
						<Input
							value={guestName}
							onChange={(e) => setGuestName(e.target.value)}
							placeholder="Walk-in guest"
						/>
					</div>

					<Tabs defaultValue="pay" className="w-full">
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="pay">Take payment</TabsTrigger>
							<TabsTrigger value="room">Charge to room</TabsTrigger>
						</TabsList>

						{/* ---- Take payment (cash / card / UPI / split + Razorpay) ---- */}
						<TabsContent value="pay" className="flex flex-col gap-3 pt-3">
							<Button
								variant="default"
								className="w-full"
								disabled={busy}
								onClick={settleRazorpay}
							>
								{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
								Pay {formatINR(total)} by card / UPI (Razorpay)
							</Button>

							<div className="text-muted-foreground flex items-center gap-2 text-xs">
								<div className="bg-border h-px flex-1" /> or record manual payment{" "}
								<div className="bg-border h-px flex-1" />
							</div>

							<div className="flex flex-col gap-2">
								{rows.map((row) => (
									<div key={row.id} className="flex items-center gap-2">
										<Select
											value={row.mode}
											onValueChange={(v) =>
												setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, mode: v } : r)))
											}
										>
											<SelectTrigger className="w-36">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{PAYMENT_MODES.map((m) => (
													<SelectItem key={m} value={m}>
														{m}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<Input
											type="number"
											className="flex-1 text-right"
											value={row.amount}
											onChange={(e) =>
												setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, amount: e.target.value } : r)))
											}
										/>
										{rows.length > 1 ? (
											<Button
												size="icon"
												variant="ghost"
												onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
											>
												<Trash2 className="size-4" />
											</Button>
										) : null}
									</div>
								))}
								<Button
									variant="outline"
									size="sm"
									className="self-start"
									onClick={() =>
										setRows((rs) => [
											...rs,
											{ id: Math.max(...rs.map((r) => r.id)) + 1, mode: "Card", amount: String(Math.max(balance, 0)) },
										])
									}
								>
									<Plus className="mr-1 size-3.5" /> Split payment
								</Button>
							</div>

							<div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
								<span className="text-muted-foreground">
									Paid {formatINR(paid)}
									{Math.abs(balance) > 0.009 ? (
										<span className={balance > 0 ? "text-destructive ml-2" : "ml-2 text-success"}>
											· {balance > 0 ? "balance" : "change"} {formatINR(Math.abs(balance))}
										</span>
									) : null}
								</span>
							</div>

							<Button className="w-full" disabled={busy} onClick={settleManual} data-testid="settle-confirm">
								{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
								Confirm payment &amp; close
							</Button>
						</TabsContent>

						{/* ---- Charge to room (in-house guest) ---- */}
						<TabsContent value="room" className="flex flex-col gap-3 pt-3">
							<div className="flex gap-2">
								<Input
									placeholder="Search guest or room…"
									value={staySearch}
									onChange={(e) => setStaySearch(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && searchStays()}
								/>
								<Button variant="outline" onClick={searchStays}>
									Search
								</Button>
							</div>
							<div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
								{stays.length === 0 ? (
									<p className="text-muted-foreground py-4 text-center text-sm">No in-house guests.</p>
								) : (
									stays.map((s) => (
										<button
											key={s.name}
											type="button"
											onClick={() => setPickedStay(s)}
											className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
												pickedStay?.name === s.name ? "border-primary bg-primary/5" : "hover:bg-muted"
											}`}
										>
											<span className="font-medium">{s.primary_guest_name ?? s.name}</span>
											<span className="text-muted-foreground">{s.current_room ?? "—"}</span>
										</button>
									))
								)}
							</div>
							<Button
								className="w-full"
								disabled={busy || !pickedStay}
								onClick={chargeToRoom}
							>
								{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
								Charge {formatINR(total)} to{" "}
								{pickedStay ? pickedStay.primary_guest_name ?? pickedStay.name : "room"}
							</Button>
						</TabsContent>
					</Tabs>
				</div>

				<button
					className="text-muted-foreground hover:text-foreground absolute right-4 top-4"
					onClick={() => onOpenChange(false)}
					aria-label="Close"
				>
					<X className="size-4" />
				</button>
			</SheetContent>
		</Sheet>
	);
}
