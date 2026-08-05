/**
 * Guest 360 view — Module 012.
 * Single-guest full picture: header, stays/folios, requests/complaints,
 * feedback, preferences, consents, loyalty transactions.
 * Route: #/guest/<guest_profile>
 */

import { useCallback, useEffect, useState } from "react";
import {
	AlertCircle,
	ArrowLeft,
	BadgeCheck,
	Ban,
	ChevronDown,
	ChevronUp,
	CreditCard,
	Heart,
	Loader2,
	MessageCircle,
	RefreshCw,
	Settings2,
	ShieldAlert,
	Star,
	UserCheck,
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
	FolioApiError,
	enrollLoyaltyMember,
	getGuest360,
	postLoyaltyTransaction,
	recordGuestConsent,
	submitFeedback,
	updateGuestPreference,
	type ConsentChannel,
	type ConsentPurpose,
	type ConsentSource,
	type ConsentStatus,
	type FeedbackContext,
	type FeedbackSentiment,
	type Guest360,
	type GuestConsent,
	type GuestFeedbackItem,
	type GuestPreference,
	type LoyaltyTransaction,
	type PreferenceSensitivity,
	type PreferenceType,
	type TransactionType,
} from "@/lib/crm-api";

// ─── helpers ───────────────────────────────────────────────────────────────

function reportError(error: unknown, fallback: string) {
	const detail =
		error instanceof FolioApiError
			? (error.blockers[0]?.message ?? error.message)
			: String(error);
	toast.error(fallback, { description: detail });
}

function VipBadge({ level }: { level: string | null }) {
	if (!level || level === "Standard" || level === "None") return null;
	const colour =
		level === "VVIP" || level === "Owner"
			? "bg-yellow-400/20 text-yellow-700 dark:text-yellow-300"
			: level === "VIP"
				? "bg-indigo-400/20 text-indigo-700 dark:text-indigo-300"
				: level === "Blacklisted"
					? "bg-red-500/20 text-red-700 dark:text-red-300"
					: "bg-muted text-muted-foreground";
	return (
		<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colour}`}>
			{level}
		</span>
	);
}

function SentimentBadge({ s }: { s: string | null }) {
	if (!s) return <span className="text-muted-foreground">—</span>;
	const colour =
		s === "Positive"
			? "bg-green-500/15 text-green-700 dark:text-green-300"
			: s === "Negative"
				? "bg-red-500/15 text-red-700 dark:text-red-300"
				: "bg-muted text-muted-foreground";
	return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colour}`}>{s}</span>;
}

function Section({
	title,
	icon,
	count,
	children,
	defaultOpen = true,
}: {
	title: string;
	icon: React.ReactNode;
	count?: number;
	children: React.ReactNode;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<Card>
			<CardHeader className="cursor-pointer select-none py-3" onClick={() => setOpen((v) => !v)}>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{icon}
						<CardTitle className="text-sm font-medium">{title}</CardTitle>
						{count !== undefined && (
							<Badge variant="secondary" className="text-xs">{count}</Badge>
						)}
					</div>
					{open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
				</div>
			</CardHeader>
			{open && <CardContent className="pt-0">{children}</CardContent>}
		</Card>
	);
}

// ─── sub-panels ────────────────────────────────────────────────────────────

function PreferencesPanel({ prefs }: { prefs: GuestPreference[] }) {
	if (prefs.length === 0) return <p className="text-sm text-muted-foreground">No preferences recorded.</p>;
	return (
		<div className="divide-y">
			{prefs.map((p) => (
				<div key={p.name} className="flex items-start justify-between py-2 text-sm">
					<div>
						<span className="font-medium">{p.preference_type}</span>
						{" — "}
						<span>{p.preference_value}</span>
						{p.notes && <p className="mt-0.5 text-muted-foreground">{p.notes}</p>}
					</div>
					<div className="flex shrink-0 items-center gap-1 pl-4">
						{p.sensitivity !== "Normal" && (
							<Badge variant="destructive" className="text-xs">{p.sensitivity}</Badge>
						)}
						{p.verified ? <BadgeCheck className="size-3.5 text-green-600" /> : null}
					</div>
				</div>
			))}
		</div>
	);
}

function ConsentsPanel({ consents }: { consents: GuestConsent[] }) {
	if (consents.length === 0) return <p className="text-sm text-muted-foreground">No consent records.</p>;
	return (
		<div className="divide-y">
			{consents.map((c) => (
				<div key={c.name} className="flex items-center justify-between py-2 text-sm">
					<div>
						<span className="font-medium">{c.purpose}</span>
						{" via "}
						<span className="text-muted-foreground">{c.channel}</span>
					</div>
					<Badge
						variant={c.status === "Granted" ? "default" : "secondary"}
						className="text-xs"
					>
						{c.status}
					</Badge>
				</div>
			))}
		</div>
	);
}

function FeedbackPanel({ items }: { items: GuestFeedbackItem[] }) {
	if (items.length === 0) return <p className="text-sm text-muted-foreground">No feedback recorded.</p>;
	return (
		<div className="divide-y">
			{items.map((f) => (
				<div key={f.name} className="py-2 text-sm">
					<div className="flex items-center justify-between">
						<span className="font-medium">{f.context}</span>
						<SentimentBadge s={f.sentiment ?? null} />
					</div>
					{f.nps_score !== null && (
						<p className="mt-0.5 text-muted-foreground">NPS {f.nps_score}/10</p>
					)}
					{f.comments && <p className="mt-0.5 text-muted-foreground line-clamp-2">{f.comments}</p>}
					<p className="mt-0.5 text-xs text-muted-foreground">{f.submitted_at?.slice(0, 10)}</p>
				</div>
			))}
		</div>
	);
}

function LoyaltyPanel({ txns }: { txns: LoyaltyTransaction[] }) {
	if (txns.length === 0) return <p className="text-sm text-muted-foreground">No transactions.</p>;
	return (
		<div className="divide-y">
			{txns.map((t) => (
				<div key={t.name} className="flex items-center justify-between py-2 text-sm">
					<div>
						<span className="font-medium">{t.transaction_type}</span>
						{t.reason && <span className="ml-1 text-muted-foreground">— {t.reason}</span>}
					</div>
					<div className="flex items-center gap-2">
						<span className={t.points >= 0 ? "text-green-600" : "text-red-600"}>
							{t.points >= 0 ? "+" : ""}{t.points} pts
						</span>
						<Badge variant="secondary" className="text-xs">{t.status}</Badge>
					</div>
				</div>
			))}
		</div>
	);
}

// ─── quick-action dialogs ───────────────────────────────────────────────────

type ActionKind = "consent" | "preference" | "enroll" | "accrue" | "feedback" | null;

function ConsentDialog({
	guestProfile,
	onClose,
	onDone,
}: {
	guestProfile: string;
	onClose: () => void;
	onDone: () => void;
}) {
	const [purpose, setPurpose] = useState<ConsentPurpose>("Marketing");
	const [channel, setChannel] = useState<ConsentChannel>("Email");
	const [status, setStatus] = useState<ConsentStatus>("Granted");
	const [saving, setSaving] = useState(false);

	async function save() {
		setSaving(true);
		try {
			await recordGuestConsent({
				guest_profile: guestProfile,
				purpose,
				channel,
				status,
				source: "Staff" as ConsentSource,
			});
			toast.success("Consent recorded");
			onDone();
		} catch (e) {
			reportError(e, "Failed to record consent");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet open onOpenChange={onClose}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Record consent</SheetTitle>
					<SheetDescription>Log a new guest consent or withdrawal.</SheetDescription>
				</SheetHeader>
				<div className="mt-4 grid gap-3">
					<div className="grid gap-1.5">
						<Label>Purpose</Label>
						<Select value={purpose} onValueChange={(v) => setPurpose(v as ConsentPurpose)}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{(["Marketing", "Feedback", "Profiling", "Third Party Sharing", "Loyalty", "Transactional"] as ConsentPurpose[]).map(
									(p) => <SelectItem key={p} value={p}>{p}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label>Channel</Label>
						<Select value={channel} onValueChange={(v) => setChannel(v as ConsentChannel)}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{(["Email", "SMS", "WhatsApp", "Phone", "Postal", "App", "Any"] as ConsentChannel[]).map(
									(c) => <SelectItem key={c} value={c}>{c}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label>Status</Label>
						<Select value={status} onValueChange={(v) => setStatus(v as ConsentStatus)}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{(["Granted", "Withdrawn", "Expired", "Unknown"] as ConsentStatus[]).map(
									(s) => <SelectItem key={s} value={s}>{s}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose}>Cancel</Button>
					<Button onClick={save} disabled={saving}>
						{saving && <Loader2 className="mr-2 size-4 animate-spin" />}
						Save
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function PreferenceDialog({
	guestProfile,
	onClose,
	onDone,
}: {
	guestProfile: string;
	onClose: () => void;
	onDone: () => void;
}) {
	const [type, setType] = useState<PreferenceType>("Room");
	const [value, setValue] = useState("");
	const [sensitivity, setSensitivity] = useState<PreferenceSensitivity>("Normal");
	const [saving, setSaving] = useState(false);

	async function save() {
		if (!value.trim()) { toast.error("Preference value is required"); return; }
		setSaving(true);
		try {
			await updateGuestPreference({
				guest_profile: guestProfile,
				preference_type: type,
				preference_value: value.trim(),
				sensitivity,
				source: "Staff",
			});
			toast.success("Preference saved");
			onDone();
		} catch (e) {
			reportError(e, "Failed to save preference");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet open onOpenChange={onClose}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Add preference</SheetTitle>
					<SheetDescription>Record a guest preference or allergy.</SheetDescription>
				</SheetHeader>
				<div className="mt-4 grid gap-3">
					<div className="grid gap-1.5">
						<Label>Type</Label>
						<Select value={type} onValueChange={(v) => setType(v as PreferenceType)}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{(["Room", "Pillow", "Food", "Allergy", "Accessibility", "Communication", "Occasion", "Other"] as PreferenceType[]).map(
									(t) => <SelectItem key={t} value={t}>{t}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label>Value</Label>
						<Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. High floor, No dairy" />
					</div>
					<div className="grid gap-1.5">
						<Label>Sensitivity</Label>
						<Select value={sensitivity} onValueChange={(v) => setSensitivity(v as PreferenceSensitivity)}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{(["Normal", "Allergy", "Medical", "Accessibility", "Private"] as PreferenceSensitivity[]).map(
									(s) => <SelectItem key={s} value={s}>{s}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose}>Cancel</Button>
					<Button onClick={save} disabled={saving}>
						{saving && <Loader2 className="mr-2 size-4 animate-spin" />}
						Save
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function EnrollDialog({
	guestProfile,
	onClose,
	onDone,
}: {
	guestProfile: string;
	onClose: () => void;
	onDone: () => void;
}) {
	const [saving, setSaving] = useState(false);

	async function save() {
		setSaving(true);
		try {
			await enrollLoyaltyMember({ guest_profile: guestProfile });
			toast.success("Enrolled in loyalty programme");
			onDone();
		} catch (e) {
			reportError(e, "Enrolment failed");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet open onOpenChange={onClose}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Enrol in loyalty</SheetTitle>
					<SheetDescription>Enrol this guest in the default REEZORT Rewards programme.</SheetDescription>
				</SheetHeader>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose}>Cancel</Button>
					<Button onClick={save} disabled={saving}>
						{saving && <Loader2 className="mr-2 size-4 animate-spin" />}
						Enrol
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function AccrualDialog({
	membershipName,
	onClose,
	onDone,
}: {
	membershipName: string;
	onClose: () => void;
	onDone: () => void;
}) {
	const [txnType, setTxnType] = useState<TransactionType>("Accrual");
	const [points, setPoints] = useState("");
	const [reason, setReason] = useState("");
	const [saving, setSaving] = useState(false);

	async function save() {
		const pts = parseFloat(points);
		if (!pts || isNaN(pts)) { toast.error("Enter a valid points amount"); return; }
		setSaving(true);
		try {
			await postLoyaltyTransaction({
				loyalty_membership: membershipName,
				transaction_type: txnType,
				points: pts,
				reason: reason.trim() || undefined,
			});
			toast.success("Transaction posted");
			onDone();
		} catch (e) {
			reportError(e, "Transaction failed");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet open onOpenChange={onClose}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Post loyalty transaction</SheetTitle>
				</SheetHeader>
				<div className="mt-4 grid gap-3">
					<div className="grid gap-1.5">
						<Label>Type</Label>
						<Select value={txnType} onValueChange={(v) => setTxnType(v as TransactionType)}>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{(["Accrual", "Redemption", "Adjustment", "Reversal"] as TransactionType[]).map(
									(t) => <SelectItem key={t} value={t}>{t}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label>Points</Label>
						<Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 100" />
					</div>
					<div className="grid gap-1.5">
						<Label>Reason</Label>
						<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
					</div>
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose}>Cancel</Button>
					<Button onClick={save} disabled={saving}>
						{saving && <Loader2 className="mr-2 size-4 animate-spin" />}
						Post
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function FeedbackDialog({
	guestProfile,
	onClose,
	onDone,
}: {
	guestProfile: string;
	onClose: () => void;
	onDone: () => void;
}) {
	const [nps, setNps] = useState("");
	const [context, setContext] = useState<FeedbackContext>("General");
	const [comments, setComments] = useState("");
	const [saving, setSaving] = useState(false);

	async function save() {
		if (!nps && !comments.trim()) {
			toast.error("Enter NPS score or comments");
			return;
		}
		setSaving(true);
		try {
			await submitFeedback({
				guest_profile: guestProfile,
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
					<SheetDescription>Record guest feedback on behalf of the guest.</SheetDescription>
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

// ─── main component ─────────────────────────────────────────────────────────

export default function Guest360({ guestProfile }: { guestProfile: string }) {
	const [data, setData] = useState<Guest360 | null>(null);
	const [loadState, setLoadState] = useState<"loading" | "live" | "error">("loading");
	const [action, setAction] = useState<ActionKind>(null);

	const load = useCallback(async () => {
		setLoadState("loading");
		try {
			const result = await getGuest360(guestProfile);
			setData(result);
			setLoadState("live");
		} catch (e) {
			reportError(e, "Failed to load guest profile");
			setLoadState("error");
		}
	}, [guestProfile]);

	useEffect(() => { void load(); }, [load]);

	function handleDone() {
		setAction(null);
		void load();
	}

	if (loadState === "loading") {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<Loader2 className="size-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (loadState === "error" || !data) {
		return (
			<div className="flex flex-col items-center gap-4 p-8">
				<AlertCircle className="size-8 text-destructive" />
				<p className="text-muted-foreground">Could not load guest profile.</p>
				<Button variant="outline" onClick={load}>
					<RefreshCw className="mr-2 size-4" /> Retry
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 p-4 lg:p-6">
			{/* Back nav */}
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" asChild>
					<a href="/resort-app#/crm">
						<ArrowLeft className="mr-1 size-4" /> All guests
					</a>
				</Button>
			</div>

			{/* Header card */}
			<Card>
				<CardContent className="pt-4">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="flex items-start gap-4">
							<div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground">
								{(data.full_name ?? "?")[0]?.toUpperCase()}
							</div>
							<div>
								<div className="flex flex-wrap items-center gap-2">
									<h1 className="text-xl font-semibold">{data.full_name}</h1>
									<VipBadge level={data.vip_level ?? null} />
									{data.do_not_contact && (
										<Badge variant="destructive" className="gap-1">
											<Ban className="size-3" /> Do not contact
										</Badge>
									)}
								</div>
								<p className="mt-0.5 text-sm text-muted-foreground">
									{[data.primary_email, data.primary_phone].filter(Boolean).join(" · ")}
								</p>
								<div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
									{data.nationality && <span>{data.nationality}</span>}
									{data.guest_type && <span>{data.guest_type}</span>}
									{data.lifetime_stays > 0 && (
										<span>{data.lifetime_stays} stays</span>
									)}
									{data.last_stay_date && <span>Last: {data.last_stay_date}</span>}
								</div>
							</div>
						</div>

						{/* Loyalty summary */}
						{data.loyalty && (
							<div className="rounded-lg bg-muted px-4 py-3 text-right">
								<p className="text-xs text-muted-foreground">{data.loyalty.loyalty_program}</p>
								<p className="text-lg font-semibold">{data.loyalty.points_balance.toLocaleString()} pts</p>
								{data.loyalty.tier && (
									<p className="text-xs text-muted-foreground">{data.loyalty.tier} tier</p>
								)}
								<Badge variant="outline" className="mt-1 text-xs">{data.loyalty.status}</Badge>
							</div>
						)}
					</div>

					<Separator className="my-3" />

					{/* Quick actions */}
					<div className="flex flex-wrap gap-2">
						<Button size="sm" variant="outline" onClick={() => setAction("consent")}>
							<ShieldAlert className="mr-1.5 size-3.5" /> Record consent
						</Button>
						<Button size="sm" variant="outline" onClick={() => setAction("preference")}>
							<Settings2 className="mr-1.5 size-3.5" /> Add preference
						</Button>
						<Button size="sm" variant="outline" onClick={() => setAction("feedback")}>
							<MessageCircle className="mr-1.5 size-3.5" /> Submit feedback
						</Button>
						{!data.loyalty ? (
							<Button size="sm" variant="outline" onClick={() => setAction("enroll")}>
								<Star className="mr-1.5 size-3.5" /> Enrol in loyalty
							</Button>
						) : (
							<Button size="sm" variant="outline" onClick={() => setAction("accrue")}>
								<CreditCard className="mr-1.5 size-3.5" /> Post points
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Content grid */}
			<div className="grid gap-4 lg:grid-cols-2">
				<Section
					title="Preferences"
					icon={<Heart className="size-4 text-muted-foreground" />}
					count={data.preferences.length}
				>
					<PreferencesPanel prefs={data.preferences} />
				</Section>

				<Section
					title="Consents"
					icon={<UserCheck className="size-4 text-muted-foreground" />}
					count={data.consents.length}
				>
					<ConsentsPanel consents={data.consents} />
				</Section>

				<Section
					title="Feedback"
					icon={<MessageCircle className="size-4 text-muted-foreground" />}
					count={data.feedback.length}
					defaultOpen={false}
				>
					<FeedbackPanel items={data.feedback} />
				</Section>

				<Section
					title="Loyalty transactions"
					icon={<CreditCard className="size-4 text-muted-foreground" />}
					count={data.loyalty_transactions.length}
					defaultOpen={false}
				>
					<LoyaltyPanel txns={data.loyalty_transactions} />
				</Section>

				{(data.requests.length > 0 || data.complaints.length > 0) && (
					<Section
						title="Requests & complaints"
						icon={<AlertCircle className="size-4 text-muted-foreground" />}
						count={(data.requests as unknown[]).length + (data.complaints as unknown[]).length}
						defaultOpen={false}
					>
						<p className="text-sm text-muted-foreground">
							{(data.requests as unknown[]).length} requests · {(data.complaints as unknown[]).length} complaints
						</p>
					</Section>
				)}

				{data.stays.length > 0 && (
					<Section
						title="Stays"
						icon={<Heart className="size-4 text-muted-foreground" />}
						count={data.stays.length}
						defaultOpen={false}
					>
						<p className="text-sm text-muted-foreground">{data.stays.length} stay record(s)</p>
					</Section>
				)}
			</div>

			{/* Dialogs */}
			{action === "consent" && (
				<ConsentDialog guestProfile={guestProfile} onClose={() => setAction(null)} onDone={handleDone} />
			)}
			{action === "preference" && (
				<PreferenceDialog guestProfile={guestProfile} onClose={() => setAction(null)} onDone={handleDone} />
			)}
			{action === "enroll" && (
				<EnrollDialog guestProfile={guestProfile} onClose={() => setAction(null)} onDone={handleDone} />
			)}
			{action === "accrue" && data.loyalty && (
				<AccrualDialog membershipName={data.loyalty.name} onClose={() => setAction(null)} onDone={handleDone} />
			)}
			{action === "feedback" && (
				<FeedbackDialog guestProfile={guestProfile} onClose={() => setAction(null)} onDone={handleDone} />
			)}
		</div>
	);
}
