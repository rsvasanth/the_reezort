/**
 * OtaInbox — #/integrations/ota-inbox (spec 013 first slice).
 *
 * OTA reservation messages across four states with a count KPI strip,
 * state/source/search filters, an Import (paste/upload) flow, and a Review
 * sheet per message (convert / reject). Live-with-mock fallback.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, RefreshCw, Search, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { EASE_OUT } from "@/lib/motion";
import { FolioApiError } from "@/lib/folio-api";
import { OtaReviewSheet } from "@/components/integrations/ota-review-sheet";
import { OtaUploadSheet } from "@/components/integrations/ota-upload-sheet";
import {
	MOCK_INBOX,
	listInbox,
	type InboxResult,
	type OtaMessage,
	type OtaMessageState,
} from "@/lib/ota-api";

import { formatDateShort, relativeTime, stateTone } from "./ota-format";

type LoadState = "loading" | "live" | "mock";

const STATE_FILTERS = ["All", "New", "Converted", "Rejected", "Dead-letter"] as const;
const KPIS: OtaMessageState[] = ["New", "Converted", "Rejected", "Dead-letter"];

function formatMoney(n: number | null, currency: string | null): string {
	if (n === null) return "—";
	try {
		return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(n);
	} catch {
		return `${n}`;
	}
}

export default function OtaInbox() {
	const [data, setData] = useState<InboxResult | null>(null);
	const [state, setState] = useState<LoadState>("loading");
	const [stateFilter, setStateFilter] = useState<(typeof STATE_FILTERS)[number]>("New");
	const [sourceFilter, setSourceFilter] = useState<string>("Any");
	const [search, setSearch] = useState("");
	const [uploadOpen, setUploadOpen] = useState(false);
	const [reviewName, setReviewName] = useState<string | null>(null);

	const load = useCallback((quiet = false) => {
		if (!quiet) setState("loading");
		listInbox({
			state: stateFilter === "All" ? undefined : stateFilter,
			source: sourceFilter === "Any" ? undefined : sourceFilter,
			search: search.trim() || undefined,
			limit: 100,
		})
			.then((res) => {
				setData(res);
				setState("live");
			})
			.catch((error: unknown) => {
				if (error instanceof FolioApiError) {
					toast.error("Could not load inbox", { description: error.blockers[0]?.message ?? error.message });
					setData({ messages: [], counts: { New: 0, Converted: 0, Rejected: 0, "Dead-letter": 0 }, sources: [] });
					setState("live");
					return;
				}
				setData(MOCK_INBOX);
				setState("mock");
			});
	}, [stateFilter, sourceFilter, search]);

	useEffect(() => {
		const t = window.setTimeout(() => load(), search ? 250 : 0);
		return () => window.clearTimeout(t);
	}, [load, search]);

	const counts = data?.counts ?? { New: 0, Converted: 0, Rejected: 0, "Dead-letter": 0 };
	const messages = useMemo(() => data?.messages ?? [], [data]);

	return (
		<main className="flex flex-1 flex-col gap-6  px-4 py-6 lg:px-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<Badge variant="outline">{state === "live" ? "Live" : state === "loading" ? "Loading" : "Mock"}</Badge>
						<Badge variant="secondary">OTA inbox</Badge>
					</div>
					<h1 className="font-display text-3xl font-light tracking-tight">OTA reservations</h1>
					<p className="mt-1 text-sm text-muted-foreground">{counts.New} new to review</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" aria-label="Refresh" onClick={() => load()}>
						<RefreshCw className="size-4" />
					</Button>
					<Button className="bg-brass text-brass-foreground hover:bg-brass/90" onClick={() => setUploadOpen(true)} data-testid="ota-import-open">
						<Upload className="mr-1.5 size-4" /> Import
					</Button>
				</div>
			</div>

			{/* KPI strip — click to filter by state */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{KPIS.map((k) => {
					const tone = stateTone(k);
					const active = stateFilter === k;
					return (
						<button
							key={k}
							type="button"
							onClick={() => setStateFilter(active ? "All" : k)}
							className={`flex flex-col items-start gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors hover:border-brass/40 ${active ? "border-brass/60" : ""}`}
							data-testid={`kpi-${k}`}
						>
							<span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{k}</span>
							<span className="font-display text-2xl font-light tabular-nums">{counts[k] ?? 0}</span>
							<Badge variant="outline" className={`text-[10px] ${tone.badge}`}>{tone.label}</Badge>
						</button>
					);
				})}
			</div>

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-2">
				<Select value={stateFilter} onValueChange={(v) => setStateFilter(v as typeof stateFilter)}>
					<SelectTrigger className="w-36" data-testid="filter-state"><SelectValue /></SelectTrigger>
					<SelectContent>{STATE_FILTERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
				</Select>
				<Select value={sourceFilter} onValueChange={setSourceFilter}>
					<SelectTrigger className="w-40" data-testid="filter-source"><SelectValue /></SelectTrigger>
					<SelectContent>
						<SelectItem value="Any">Any source</SelectItem>
						{(data?.sources ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
					</SelectContent>
				</Select>
				<div className="relative ml-auto w-full max-w-xs">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input className="pl-8" placeholder="Search guest, id…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="filter-search" />
				</div>
			</div>

			{state === "loading" ? (
				<div className="flex flex-col gap-3">
					{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
				</div>
			) : messages.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
					<Upload className="size-7 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">
						{search || stateFilter !== "All" || sourceFilter !== "Any" ? "No messages match — clear filters." : "No OTA messages yet. Import an export to begin."}
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{messages.map((msg, i) => (
						<motion.div
							key={msg.name}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.3, ease: EASE_OUT, delay: Math.min(i * 0.04, 0.4) }}
						>
							<MessageRow msg={msg} onReview={() => setReviewName(msg.name)} />
						</motion.div>
					))}
				</div>
			)}

			<OtaUploadSheet open={uploadOpen} onOpenChange={setUploadOpen} sources={data?.sources} onIngested={() => load(true)} />
			<OtaReviewSheet name={reviewName} open={reviewName !== null} onOpenChange={(v) => !v && setReviewName(null)} onActioned={() => load(true)} />
		</main>
	);
}

function MessageRow({ msg, onReview }: { msg: OtaMessage; onReview: () => void }) {
	const tone = stateTone(msg.state);
	return (
		<button type="button" onClick={onReview} className="w-full rounded-xl border bg-card p-4 text-left transition-colors hover:border-brass/40" data-testid={`ota-row-${msg.name}`}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<span className="truncate text-sm font-medium">{msg.parsed_guest_name ?? "(no name)"}</span>
						<Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">{msg.source}</Badge>
						<Badge variant="outline" className={`text-[10px] ${tone.badge}`}>{tone.label}</Badge>
					</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
						<span className="font-mono">{msg.external_id}</span>
						<span>· {formatDateShort(msg.parsed_arrival)}→{formatDateShort(msg.parsed_departure)}</span>
						<span>· {formatMoney(msg.parsed_total, msg.parsed_currency)}</span>
						<span>· {relativeTime(msg.received_at)}</span>
					</div>
				</div>
				<span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
					{msg.state === "New" ? "Review" : "View"} <ArrowRight className="size-3.5" />
				</span>
			</div>
		</button>
	);
}
