/**
 * Service Desk — unified guest + maintenance/IT ticketing with live SLA.
 * Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { Field } from "@/components/workspace/field";
import { useFrappeAuth } from "frappe-react-sdk";
import { Loader2, Plus, AlarmClock, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	FolioApiError,
	assignTicket,
	createTicket,
	getServiceBoard,
	updateTicketStatus,
	type ServiceBoard,
	type ServiceTicket,
} from "@/lib/servicedesk-api";
import { listSetupOptions, type PropertyOption } from "@/lib/setup-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function slaLabel(t: ServiceTicket): { text: string; danger: boolean } {
	if (t.status === "Resolved" || t.status === "Closed" || t.status === "Cancelled") {
		return { text: t.status, danger: false };
	}
	if (t.is_overdue) return { text: "Overdue", danger: true };
	const m = t.minutes_remaining;
	if (m == null) return { text: "—", danger: false };
	if (m >= 60) return { text: `${Math.floor(m / 60)}h ${m % 60}m left`, danger: false };
	return { text: `${m}m left`, danger: m <= 15 };
}

const PRIORITY_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
	Urgent: "destructive",
	High: "destructive",
	Normal: "secondary",
	Low: "outline",
};

export default function ServiceDeskScreen() {
	const { currentUser } = useFrappeAuth();
	const [board, setBoard] = useState<ServiceBoard | null>(null);
	const [properties, setProperties] = useState<PropertyOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [denied, setDenied] = useState(false);
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [creating, setCreating] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setBoard(await getServiceBoard(undefined, statusFilter === "all" ? undefined : statusFilter));
		} catch (error) {
			if (error instanceof FolioApiError && error.status === 403) setDenied(true);
			else reportError(error, "Could not load tickets");
		} finally {
			setLoading(false);
		}
	}, [statusFilter]);

	useEffect(() => {
		reload();
	}, [reload]);

	useEffect(() => {
		listSetupOptions().then((o) => setProperties(o.properties)).catch(() => {});
	}, []);

	async function act(ticket: string, fn: () => Promise<unknown>, success: string) {
		setBusy(ticket);
		try {
			await fn();
			toast.success(success);
			await reload();
		} catch (error) {
			reportError(error, "Action failed");
		} finally {
			setBusy(null);
		}
	}

	return (
		<main className="flex flex-1 flex-col gap-6 bg-background px-4 py-6 lg:px-6" data-testid="servicedesk-screen">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<Badge variant="outline" className="mb-2">Service desk</Badge>
					<h1 className="text-3xl font-light text-foreground md:text-4xl">Service desk</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						One queue — guest requests, complaints, housekeeping, maintenance, IT — with SLAs.
					</p>
				</div>
				<Button onClick={() => setCreating(true)} data-testid="new-ticket" disabled={denied}>
					<Plus className="size-4" /> New ticket
				</Button>
			</header>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : denied ? (
				<Card><CardContent className="py-8 text-sm text-muted-foreground">
					You do not have permission to view the service desk.
				</CardContent></Card>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-3">
						{board && board.overdue > 0 ? (
							<Badge variant="destructive" className="gap-1" data-testid="overdue-badge">
								<AlarmClock className="size-3.5" /> {board.overdue} overdue
							</Badge>
						) : null}
						{board
							? Object.entries(board.counts)
									.filter(([, n]) => n > 0)
									.map(([s, n]) => <Badge key={s} variant="secondary">{n} {s}</Badge>)
							: null}
						<div className="ml-auto w-40">
							<Select value={statusFilter} onValueChange={setStatusFilter}>
								<SelectTrigger><SelectValue /></SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All statuses</SelectItem>
									{(board?.statuses ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Ticket</TableHead>
									<TableHead>Category</TableHead>
									<TableHead>Priority</TableHead>
									<TableHead>SLA</TableHead>
									<TableHead>Assignee</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{board?.tickets.map((t) => {
									const sla = slaLabel(t);
									return (
										<TableRow key={t.name} data-testid={`ticket-${t.name}`}>
											<TableCell>
												<div className="font-medium">{t.subject}</div>
												<div className="text-xs text-muted-foreground">{t.name}{t.room ? ` · ${t.room}` : ""}</div>
											</TableCell>
											<TableCell className="text-sm">{t.category}</TableCell>
											<TableCell>
												<Badge variant={PRIORITY_VARIANT[t.priority] ?? "secondary"}>{t.priority}</Badge>
											</TableCell>
											<TableCell>
												<span className="flex items-center gap-1 text-sm">
													{t.escalated ? <Badge variant="destructive">Escalated</Badge> : null}
													<span className={sla.danger ? "font-medium text-destructive" : "text-muted-foreground"}>{sla.text}</span>
												</span>
											</TableCell>
											<TableCell className="text-sm">{t.assigned_to ?? "—"}</TableCell>
											<TableCell>
												<Select
													value={t.status}
													onValueChange={(s) => act(t.name, () => updateTicketStatus(t.name, s), `Set ${s}`)}
												>
													<SelectTrigger className="h-8 w-36" data-testid={`status-${t.name}`}><SelectValue /></SelectTrigger>
													<SelectContent>
														{(board?.statuses ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="icon"
													aria-label="Assign to me"
													disabled={busy === t.name || !currentUser}
													onClick={() => act(t.name, () => assignTicket(t.name, currentUser!), "Assigned to you")}
												>
													<UserPlus className="size-4" />
												</Button>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				</>
			)}

			{creating ? (
				<NewTicketSheet
					properties={properties}
					onClose={() => setCreating(false)}
					onCreated={reload}
					categories={board?.categories ?? []}
					priorities={board?.priorities ?? []}
				/>
			) : null}
		</main>
	);
}

function NewTicketSheet({
	properties,
	categories,
	priorities,
	onClose,
	onCreated,
}: {
	properties: PropertyOption[];
	categories: string[];
	priorities: string[];
	onClose: () => void;
	onCreated: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [form, setForm] = useState({
		resort_property: properties[0]?.name ?? "",
		subject: "",
		category: categories[0] ?? "Guest Request",
		priority: "Normal",
		description: "",
	});

	// Properties may finish loading after this sheet mounts — adopt the first once available.
	useEffect(() => {
		if (!form.resort_property && properties[0]) {
			setForm((f) => ({ ...f, resort_property: properties[0].name }));
		}
	}, [properties, form.resort_property]);

	async function save() {
		setBusy(true);
		try {
			await createTicket({
				resort_property: form.resort_property,
				subject: form.subject,
				category: form.category,
				priority: form.priority as "Low" | "Normal" | "High" | "Urgent",
				description: form.description || null,
				idempotency_key: crypto.randomUUID(),
			});
			toast.success("Ticket created");
			onCreated();
			onClose();
		} catch (error) {
			reportError(error, "Could not create ticket");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md" data-testid="ticket-sheet">
				<SheetHeader>
					<SheetTitle>New ticket</SheetTitle>
					<SheetDescription>Raise a guest or maintenance/IT request.</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 py-4">
					<Field label="Property">
						<Select value={form.resort_property} onValueChange={(v) => setForm({ ...form, resort_property: v })}>
							<SelectTrigger data-testid="t-property"><SelectValue placeholder="Property" /></SelectTrigger>
							<SelectContent>
								{properties.map((p) => <SelectItem key={p.name} value={p.name}>{p.property_name}</SelectItem>)}
							</SelectContent>
						</Select>
					</Field>
					<Field label="Subject">
						<Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. AC not cooling in 204" data-testid="t-subject" />
					</Field>
					<div className="grid grid-cols-2 gap-3">
						<Field label="Category">
							<Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
								<SelectTrigger data-testid="t-category"><SelectValue /></SelectTrigger>
								<SelectContent>
									{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
								</SelectContent>
							</Select>
						</Field>
						<Field label="Priority">
							<Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
								<SelectTrigger data-testid="t-priority"><SelectValue /></SelectTrigger>
								<SelectContent>
									{priorities.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
								</SelectContent>
							</Select>
						</Field>
					</div>
					<Field label="Description">
						<textarea
							value={form.description}
							onChange={(e) => setForm({ ...form, description: e.target.value })}
							rows={3}
							className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						/>
					</Field>
				</div>
				<SheetFooter>
					<Button onClick={save} disabled={busy || !form.subject || !form.resort_property} data-testid="ticket-save">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Create ticket
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
