/**
 * CRM / Guest Relations hub — Module 012.
 * Searchable guest list → deep-links to Guest 360.
 * Tabs: Guests | Loyalty | Feedback
 * Route: #/crm
 */

import { useCallback, useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace";
import {
	AlertCircle,
	CreditCard,
	Loader2,
	MessageCircle,
	Plus,
	RefreshCw,
	Search,
	Star,
	UserPlus,
	Users,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
	FolioApiError,
	createOrUpdateGuestProfile,
	listFeedback,
	listGuestProfiles,
	submitFeedback,
	type FeedbackContext,
	type FeedbackSentiment,
	type FeedbackStatus,
	type GuestFeedbackItem,
	type GuestProfileListItem,
	type GuestProfileStatus,
	type VipLevel,
} from "@/lib/crm-api";

// ─── helpers ───────────────────────────────────────────────────────────────

function reportError(error: unknown, fallback: string) {
	const detail =
		error instanceof FolioApiError
			? (error.blockers[0]?.message ?? error.message)
			: String(error);
	toast.error(fallback, { description: detail });
}

function VipBadge({ level }: { level: VipLevel | null }) {
	if (!level || level === "Standard" || level === "None") return null;
	return <Badge variant="outline" className="text-xs">{level}</Badge>;
}

function StatusBadge({ status }: { status: GuestProfileStatus }) {
	const v = status === "Active" ? "default" : "secondary";
	return <Badge variant={v} className="text-xs">{status}</Badge>;
}

function SentimentDot({ s }: { s: FeedbackSentiment | null }) {
	const colour =
		s === "Positive" ? "text-green-600" : s === "Negative" ? "text-red-600" : "text-muted-foreground";
	return <span className={`text-xs font-medium ${colour}`}>{s ?? "—"}</span>;
}

// ─── new guest dialog ───────────────────────────────────────────────────────

function NewGuestDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
	const [fullName, setFullName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [saving, setSaving] = useState(false);

	async function save() {
		if (!fullName.trim()) { toast.error("Full name is required"); return; }
		setSaving(true);
		try {
			const result = await createOrUpdateGuestProfile({
				full_name: fullName.trim(),
				email: email.trim() || undefined,
				phone: phone.trim() || undefined,
				source: "Staff",
			});
			toast.success("Guest profile created");
			onDone(result.guest_profile);
		} catch (e) {
			reportError(e, "Failed to create guest profile");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet open onOpenChange={onClose}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>New guest profile</SheetTitle>
					<SheetDescription>Create or find an existing guest by email / phone.</SheetDescription>
				</SheetHeader>
				<div className="mt-4 grid gap-3">
					<div className="grid gap-1.5">
						<Label>Full name <span className="text-destructive">*</span></Label>
						<Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Asha Mehta" />
					</div>
					<div className="grid gap-1.5">
						<Label>Email</Label>
						<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
					</div>
					<div className="grid gap-1.5">
						<Label>Phone</Label>
						<Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" />
					</div>
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose}>Cancel</Button>
					<Button onClick={save} disabled={saving}>
						{saving && <Loader2 className="mr-2 size-4 animate-spin" />}
						Create
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ─── quick feedback dialog ──────────────────────────────────────────────────

function QuickFeedbackDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
	const [nps, setNps] = useState("");
	const [context, setContext] = useState<FeedbackContext>("General");
	const [comments, setComments] = useState("");
	const [saving, setSaving] = useState(false);

	async function save() {
		if (!nps && !comments.trim()) { toast.error("Enter NPS score or comments"); return; }
		setSaving(true);
		try {
			await submitFeedback({
				context,
				nps_score: nps ? parseInt(nps, 10) : undefined,
				comments: comments.trim() || undefined,
			});
			toast.success("Feedback submitted");
			onDone();
		} catch (e) {
			reportError(e, "Failed to submit feedback");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet open onOpenChange={onClose}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Submit feedback</SheetTitle>
				</SheetHeader>
				<div className="mt-4 grid gap-3">
					<div className="grid gap-1.5">
						<Label>Context</Label>
						<Select value={context} onValueChange={(v) => setContext(v as FeedbackContext)}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{(["Stay", "Post Stay", "F&B", "Event", "Guest Service", "Maintenance", "General"] as FeedbackContext[]).map(
									(c) => <SelectItem key={c} value={c}>{c}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label>NPS score (0–10)</Label>
						<Input type="number" min={0} max={10} value={nps} onChange={(e) => setNps(e.target.value)} placeholder="Optional" />
					</div>
					<div className="grid gap-1.5">
						<Label>Comments</Label>
						<Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Guest remarks…" />
					</div>
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose}>Cancel</Button>
					<Button onClick={save} disabled={saving}>
						{saving && <Loader2 className="mr-2 size-4 animate-spin" />}
						Submit
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ─── tabs ───────────────────────────────────────────────────────────────────

function GuestsTab() {
	const [guests, setGuests] = useState<GuestProfileListItem[]>([]);
	const [search, setSearch] = useState("");
	const [loadState, setLoadState] = useState<"loading" | "live" | "error">("loading");
	const [showNew, setShowNew] = useState(false);

	const load = useCallback(async (q: string) => {
		setLoadState("loading");
		try {
			const result = await listGuestProfiles({ search: q || undefined, limit: 50 });
			setGuests(result.guests);
			setLoadState("live");
		} catch (e) {
			reportError(e, "Failed to load guests");
			setLoadState("error");
		}
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => void load(search), 350);
		return () => clearTimeout(timer);
	}, [search, load]);

	function navigateTo(id: string) {
		window.location.hash = `/guest/${encodeURIComponent(id)}`;
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						className="pl-9"
						placeholder="Search by name, email, phone…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				<Button size="sm" onClick={() => setShowNew(true)}>
					<UserPlus className="mr-1.5 size-4" /> New guest
				</Button>
				<Button size="sm" variant="outline" onClick={() => void load(search)}>
					<RefreshCw className="size-4" />
				</Button>
			</div>

			{loadState === "loading" ? (
				<div className="flex justify-center py-8">
					<Loader2 className="size-5 animate-spin text-muted-foreground" />
				</div>
			) : loadState === "error" ? (
				<div className="flex flex-col items-center gap-2 py-8">
					<AlertCircle className="size-5 text-destructive" />
					<p className="text-sm text-muted-foreground">Failed to load guests.</p>
				</div>
			) : guests.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">No guests found.</p>
			) : (
				<div className="overflow-x-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Contact</TableHead>
								<TableHead>VIP</TableHead>
								<TableHead>Stays</TableHead>
								<TableHead>Last stay</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{guests.map((g) => (
								<TableRow
									key={g.name}
									className="cursor-pointer hover:bg-muted/50"
									onClick={() => navigateTo(g.name)}
								>
									<TableCell className="font-medium">{g.display_name}</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{g.display_contact ?? "—"}
									</TableCell>
									<TableCell>
										<VipBadge level={g.vip_level} />
									</TableCell>
									<TableCell className="text-center">{g.lifetime_stays}</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{g.last_stay_date ?? "—"}
									</TableCell>
									<TableCell>
										<StatusBadge status={g.status} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{showNew && (
				<NewGuestDialog
					onClose={() => setShowNew(false)}
					onDone={(id) => {
						setShowNew(false);
						navigateTo(id);
					}}
				/>
			)}
		</div>
	);
}

function FeedbackTab() {
	const [items, setItems] = useState<GuestFeedbackItem[]>([]);
	const [filter, setFilter] = useState<FeedbackStatus | "">("");
	const [loadState, setLoadState] = useState<"loading" | "live" | "error">("loading");
	const [showNew, setShowNew] = useState(false);

	const load = useCallback(async (status: FeedbackStatus | "") => {
		setLoadState("loading");
		try {
			const result = await listFeedback({ status: status || undefined, limit: 50 });
			setItems(result.feedback);
			setLoadState("live");
		} catch (e) {
			reportError(e, "Failed to load feedback");
			setLoadState("error");
		}
	}, []);

	useEffect(() => { void load(filter); }, [filter, load]);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<Select value={filter} onValueChange={(v) => setFilter(v as FeedbackStatus | "")}>
					<SelectTrigger className="w-48">
						<SelectValue placeholder="All statuses" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">All statuses</SelectItem>
						{(["New", "Reviewed", "Follow Up Required", "Linked to Complaint", "Responded", "Closed"] as FeedbackStatus[]).map(
							(s) => <SelectItem key={s} value={s}>{s}</SelectItem>
						)}
					</SelectContent>
				</Select>
				<Button size="sm" onClick={() => setShowNew(true)}>
					<Plus className="mr-1.5 size-4" /> Submit feedback
				</Button>
				<Button size="sm" variant="outline" onClick={() => void load(filter)}>
					<RefreshCw className="size-4" />
				</Button>
			</div>

			{loadState === "loading" ? (
				<div className="flex justify-center py-8">
					<Loader2 className="size-5 animate-spin text-muted-foreground" />
				</div>
			) : loadState === "error" ? (
				<div className="flex flex-col items-center gap-2 py-8">
					<AlertCircle className="size-5 text-destructive" />
					<p className="text-sm text-muted-foreground">Failed to load feedback.</p>
				</div>
			) : items.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">No feedback recorded.</p>
			) : (
				<div className="overflow-x-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Context</TableHead>
								<TableHead>NPS</TableHead>
								<TableHead>Sentiment</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Date</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map((f) => (
								<TableRow key={f.name}>
									<TableCell className="font-medium">{f.context}</TableCell>
									<TableCell>{f.nps_score ?? "—"}</TableCell>
									<TableCell><SentimentDot s={f.sentiment ?? null} /></TableCell>
									<TableCell><Badge variant="secondary" className="text-xs">{f.status}</Badge></TableCell>
									<TableCell className="text-sm text-muted-foreground">{f.submitted_at?.slice(0, 10)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{showNew && (
				<QuickFeedbackDialog onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); void load(filter); }} />
			)}
		</div>
	);
}

// ─── main component ─────────────────────────────────────────────────────────

export default function GuestList() {
	return (
		<WorkspacePage
			title="CRM & loyalty"
			subtitle="Guest profiles, loyalty memberships, and feedback."
		>

			<Tabs defaultValue="guests">
				<TabsList className="mb-2">
					<TabsTrigger value="guests" className="gap-1.5">
						<Users className="size-3.5" /> Guests
					</TabsTrigger>
					<TabsTrigger value="loyalty" className="gap-1.5">
						<Star className="size-3.5" /> Loyalty
					</TabsTrigger>
					<TabsTrigger value="feedback" className="gap-1.5">
						<MessageCircle className="size-3.5" /> Feedback
					</TabsTrigger>
				</TabsList>

				<TabsContent value="guests">
					<GuestsTab />
				</TabsContent>

				<TabsContent value="loyalty">
					<Card>
						<CardHeader>
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<CreditCard className="size-4 text-muted-foreground" />
								Loyalty memberships
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">
								Open a guest profile to view and manage their loyalty membership, post accruals, or redeem points.
							</p>
							<Button className="mt-4" variant="outline" asChild>
								<a href="/resort-app#/crm">Search guests</a>
							</Button>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="feedback">
					<FeedbackTab />
				</TabsContent>
			</Tabs>
		</WorkspacePage>
	);
}
