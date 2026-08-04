/**
 * Property Management → Pricing tab. Built to
 * specs/002/ui-ux-rate-plans-admin.md.
 *
 * Rate Plans get full CRUD (Add sheet, active toggle, delete). Seasons and
 * Packages get a compact Add sheet each and inline active toggles. Delete on
 * Seasons/Packages is intentionally hidden — deactivate instead — since
 * deleting a Season that has been quoted breaks pricing history.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Power, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
	deletePricing,
	listPricing,
	setPricingActive,
	upsertPackage,
	upsertRatePlan,
	upsertSeason,
	type PackageRow,
	type PricingBundle,
	type RatePlanRow,
	type SeasonRow,
} from "@/lib/setup-api";

function rupees(n: number | null | undefined): string {
	if (n === null || n === undefined) return "—";
	return "₹" + Number(n).toLocaleString("en-IN");
}

export function PricingTab({ resortProperty }: { resortProperty: string }) {
	const [bundle, setBundle] = useState<PricingBundle | null>(null);
	const [loading, setLoading] = useState(true);
	const [sheet, setSheet] = useState<"rate" | "season" | "package" | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			setBundle(await listPricing(resortProperty));
		} catch (err) {
			toast.error("Could not load pricing", { description: err instanceof Error ? err.message : undefined });
		} finally {
			setLoading(false);
		}
	}, [resortProperty]);

	useEffect(() => { void reload(); }, [reload]);

	async function withReload(label: string, fn: () => Promise<unknown>) {
		try {
			await fn();
			toast.success(label);
			await reload();
		} catch (err) {
			toast.error(`${label} failed`, { description: err instanceof Error ? err.message : undefined });
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-sm font-semibold">Pricing</h2>
					<p className="text-xs text-muted-foreground">Rate plans, seasons, and packages for {resortProperty}.</p>
				</div>
				<Button size="sm" variant="outline" onClick={reload} disabled={loading}>
					{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
				</Button>
			</div>

			<Tabs defaultValue="rate">
				<TabsList>
					<TabsTrigger value="rate" data-testid="tab-rate">Rate Plans</TabsTrigger>
					<TabsTrigger value="season" data-testid="tab-season">Seasons</TabsTrigger>
					<TabsTrigger value="package" data-testid="tab-package">Packages</TabsTrigger>
				</TabsList>

				<TabsContent value="rate" className="mt-4">
					{loading ? <Skeletons /> : (
						<CardGrid
							items={bundle?.rate_plans ?? []}
							emptyText="No rate plans yet. Add BAR (Best Available Rate) to get started."
							addLabel="Add rate plan"
							onAdd={() => setSheet("rate")}
							renderCard={(p) => (
								<RatePlanCard
									key={p.name}
									plan={p}
									onToggleActive={() => withReload("Rate plan updated", () => setPricingActive("Rate Plan", p.name, !p.is_active))}
									onDelete={() => withReload("Rate plan deleted", () => deletePricing("Rate Plan", p.name))}
								/>
							)}
						/>
					)}
				</TabsContent>

				<TabsContent value="season" className="mt-4">
					{loading ? <Skeletons /> : (
						<CardGrid
							items={bundle?.seasons ?? []}
							emptyText="No seasons yet. Add a Peak or Off-season rule to shape rates by date."
							addLabel="Add season"
							onAdd={() => setSheet("season")}
							renderCard={(s) => (
								<SeasonCard
									key={s.name}
									season={s}
									onToggleActive={() => withReload("Season updated", () => setPricingActive("Season", s.name, !s.is_active))}
								/>
							)}
						/>
					)}
				</TabsContent>

				<TabsContent value="package" className="mt-4">
					{loading ? <Skeletons /> : (
						<CardGrid
							items={bundle?.packages ?? []}
							emptyText="No packages yet. Bundle nights + inclusions into a single sellable item."
							addLabel="Add package"
							onAdd={() => setSheet("package")}
							renderCard={(p) => (
								<PackageCard
									key={p.name}
									pkg={p}
									onToggleActive={() => withReload("Package updated", () => setPricingActive("Package", p.name, !p.is_active))}
								/>
							)}
						/>
					)}
				</TabsContent>
			</Tabs>

			{sheet === "rate" && (
				<RatePlanSheet resortProperty={resortProperty} onClose={() => setSheet(null)} onSaved={reload} />
			)}
			{sheet === "season" && (
				<SeasonSheet resortProperty={resortProperty} onClose={() => setSheet(null)} onSaved={reload} />
			)}
			{sheet === "package" && (
				<PackageSheet resortProperty={resortProperty} onClose={() => setSheet(null)} onSaved={reload} />
			)}
		</div>
	);
}

// ---------- helpers ----------

function Skeletons() {
	return (
		<div className="grid gap-3 lg:grid-cols-2">
			<Skeleton className="h-28 w-full" />
			<Skeleton className="h-28 w-full" />
		</div>
	);
}

function CardGrid<T>({
	items,
	emptyText,
	addLabel,
	onAdd,
	renderCard,
}: {
	items: T[];
	emptyText: string;
	addLabel: string;
	onAdd: () => void;
	renderCard: (item: T) => React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3">
			{items.length === 0 ? (
				<Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center">
					<p className="text-sm text-muted-foreground">{emptyText}</p>
					<Button onClick={onAdd}><Plus className="size-4" /> {addLabel}</Button>
				</CardContent></Card>
			) : (
				<>
					<div className="grid gap-3 lg:grid-cols-2">{items.map(renderCard)}</div>
					<div className="flex justify-center">
						<Button variant="outline" onClick={onAdd}><Plus className="size-4" /> {addLabel}</Button>
					</div>
				</>
			)}
		</div>
	);
}

function RatePlanCard({ plan, onToggleActive, onDelete }: { plan: RatePlanRow; onToggleActive: () => void; onDelete: () => void }) {
	return (
		<Card>
			<CardContent className="flex flex-col gap-2 py-4">
				<div className="flex items-center justify-between gap-2">
					<div>
						<div className="text-sm font-semibold">{plan.code} — {plan.plan_name}</div>
						<div className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
							<Badge variant={plan.is_active ? "default" : "secondary"}>{plan.is_active ? "Active" : "Inactive"}</Badge>
							<span>· Room type: {plan.room_type ?? "All"}</span>
						</div>
					</div>
					<div className="flex gap-1">
						<Button size="icon" variant="ghost" aria-label="Toggle active" onClick={onToggleActive}><Power className="size-4" /></Button>
						<Button size="icon" variant="ghost" aria-label="Delete" onClick={onDelete}><Trash2 className="size-4" /></Button>
					</div>
				</div>
				<div className="mt-1 grid grid-cols-2 gap-2 text-xs">
					<div><div className="text-muted-foreground">Base rate override</div><div className="font-medium tabular-nums">{rupees(plan.base_rate_override)}</div></div>
					<div><div className="text-muted-foreground">Weekend uplift</div><div className="font-medium tabular-nums">{plan.weekend_uplift_pct ? `+${plan.weekend_uplift_pct}%` : "—"}</div></div>
					<div><div className="text-muted-foreground">Refundable</div><div className="font-medium">{plan.refundable ? "Yes" : "No"}</div></div>
					<div><div className="text-muted-foreground">Cancellation</div><div className="font-medium">{plan.cancellation_hours}h</div></div>
				</div>
			</CardContent>
		</Card>
	);
}

function SeasonCard({ season, onToggleActive }: { season: SeasonRow; onToggleActive: () => void }) {
	const modifier = season.absolute_rate
		? `Absolute ${rupees(season.absolute_rate)}/night`
		: season.modifier_pct
			? `${season.modifier_pct > 0 ? "+" : ""}${season.modifier_pct}%`
			: "—";
	return (
		<Card>
			<CardContent className="flex flex-col gap-1 py-4">
				<div className="flex items-center justify-between">
					<div>
						<div className="text-sm font-semibold">{season.code} — {season.season_name}</div>
						<div className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
							<Badge variant={season.is_active ? "default" : "secondary"}>{season.is_active ? "Active" : "Inactive"}</Badge>
							<span>· {season.start_date} → {season.end_date}</span>
							<span>· priority {season.priority}</span>
						</div>
					</div>
					<Button size="icon" variant="ghost" aria-label="Toggle active" onClick={onToggleActive}><Power className="size-4" /></Button>
				</div>
				<div className="text-xs font-medium">{modifier}</div>
			</CardContent>
		</Card>
	);
}

function PackageCard({ pkg, onToggleActive }: { pkg: PackageRow; onToggleActive: () => void }) {
	return (
		<Card>
			<CardContent className="flex flex-col gap-1 py-4">
				<div className="flex items-center justify-between">
					<div>
						<div className="text-sm font-semibold">{pkg.code} — {pkg.package_name}</div>
						<div className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
							<Badge variant={pkg.is_active ? "default" : "secondary"}>{pkg.is_active ? "Active" : "Inactive"}</Badge>
							<span>· {pkg.nights} night{pkg.nights === 1 ? "" : "s"}</span>
							<span>· {pkg.room_type ?? "All rooms"}</span>
						</div>
					</div>
					<Button size="icon" variant="ghost" aria-label="Toggle active" onClick={onToggleActive}><Power className="size-4" /></Button>
				</div>
				<div className="mt-1 text-xs font-medium tabular-nums">{rupees(pkg.package_price)}</div>
				<div className="text-xs text-muted-foreground">{pkg.inclusions_summary || "No inclusions listed"}</div>
			</CardContent>
		</Card>
	);
}

// ---------- Add sheets ----------

function RatePlanSheet({ resortProperty, onClose, onSaved }: { resortProperty: string; onClose: () => void; onSaved: () => void }) {
	const [form, setForm] = useState({ code: "", plan_name: "", base_rate_override: "", weekend_uplift_pct: "", cancellation_hours: "24" });
	const [busy, setBusy] = useState(false);
	async function save() {
		if (!form.code || !form.plan_name) { toast.error("Code and Plan Name are required"); return; }
		setBusy(true);
		try {
			await upsertRatePlan({
				resort_property: resortProperty,
				code: form.code,
				plan_name: form.plan_name,
				base_rate_override: parseFloat(form.base_rate_override) || 0,
				weekend_uplift_pct: parseFloat(form.weekend_uplift_pct) || 0,
				cancellation_hours: parseInt(form.cancellation_hours, 10) || 24,
			});
			toast.success("Rate plan saved");
			onSaved();
			onClose();
		} catch (err) {
			toast.error("Save failed", { description: err instanceof Error ? err.message : undefined });
		} finally {
			setBusy(false);
		}
	}
	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Add rate plan</SheetTitle>
					<SheetDescription>Codes are uppercase and unique per property (e.g. BAR, CORP).</SheetDescription>
				</SheetHeader>
				<div className="mt-4 grid gap-3">
					<div className="grid gap-1.5"><Label htmlFor="rp-code">Code</Label><Input id="rp-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BAR" /></div>
					<div className="grid gap-1.5"><Label htmlFor="rp-name">Plan Name</Label><Input id="rp-name" value={form.plan_name} onChange={(e) => setForm({ ...form, plan_name: e.target.value })} placeholder="Best Available Rate" /></div>
					<div className="grid gap-1.5"><Label htmlFor="rp-base">Base rate override (₹/night)</Label><Input id="rp-base" type="number" min="0" value={form.base_rate_override} onChange={(e) => setForm({ ...form, base_rate_override: e.target.value })} placeholder="10000" /></div>
					<div className="grid gap-1.5"><Label htmlFor="rp-weekend">Weekend uplift %</Label><Input id="rp-weekend" type="number" value={form.weekend_uplift_pct} onChange={(e) => setForm({ ...form, weekend_uplift_pct: e.target.value })} placeholder="30" /></div>
					<div className="grid gap-1.5"><Label htmlFor="rp-cxl">Cancellation hours</Label><Input id="rp-cxl" type="number" value={form.cancellation_hours} onChange={(e) => setForm({ ...form, cancellation_hours: e.target.value })} /></div>
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Save rate plan</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function SeasonSheet({ resortProperty, onClose, onSaved }: { resortProperty: string; onClose: () => void; onSaved: () => void }) {
	const [form, setForm] = useState({ code: "", season_name: "", start_date: "", end_date: "", modifier_pct: "", absolute_rate: "", priority: "10" });
	const [busy, setBusy] = useState(false);
	async function save() {
		if (!form.code || !form.season_name || !form.start_date || !form.end_date) { toast.error("Code, name, and window are required"); return; }
		setBusy(true);
		try {
			await upsertSeason({
				resort_property: resortProperty,
				code: form.code,
				season_name: form.season_name,
				start_date: form.start_date,
				end_date: form.end_date,
				modifier_pct: parseFloat(form.modifier_pct) || 0,
				absolute_rate: parseFloat(form.absolute_rate) || 0,
				priority: parseInt(form.priority, 10) || 10,
			});
			toast.success("Season saved");
			onSaved();
			onClose();
		} catch (err) {
			toast.error("Save failed", { description: err instanceof Error ? err.message : undefined });
		} finally {
			setBusy(false);
		}
	}
	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Add season</SheetTitle>
					<SheetDescription>Priority tie-breaks — higher number wins on overlap.</SheetDescription>
				</SheetHeader>
				<div className="mt-4 grid gap-3">
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5"><Label htmlFor="s-code">Code</Label><Input id="s-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="PEAK" /></div>
						<div className="grid gap-1.5"><Label htmlFor="s-name">Name</Label><Input id="s-name" value={form.season_name} onChange={(e) => setForm({ ...form, season_name: e.target.value })} placeholder="Peak" /></div>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5"><Label htmlFor="s-from">Start date</Label><Input id="s-from" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
						<div className="grid gap-1.5"><Label htmlFor="s-to">End date</Label><Input id="s-to" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
					</div>
					<div className="grid grid-cols-3 gap-3">
						<div className="grid gap-1.5"><Label htmlFor="s-mod">Modifier %</Label><Input id="s-mod" type="number" value={form.modifier_pct} onChange={(e) => setForm({ ...form, modifier_pct: e.target.value })} placeholder="50 or -20" /></div>
						<div className="grid gap-1.5"><Label htmlFor="s-abs">Absolute ₹/night</Label><Input id="s-abs" type="number" min="0" value={form.absolute_rate} onChange={(e) => setForm({ ...form, absolute_rate: e.target.value })} /></div>
						<div className="grid gap-1.5"><Label htmlFor="s-pri">Priority</Label><Input id="s-pri" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
					</div>
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Save season</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function PackageSheet({ resortProperty, onClose, onSaved }: { resortProperty: string; onClose: () => void; onSaved: () => void }) {
	const [form, setForm] = useState({ code: "", package_name: "", nights: "2", package_price: "", inclusions: "" });
	const [busy, setBusy] = useState(false);
	async function save() {
		if (!form.code || !form.package_name || !form.package_price) { toast.error("Code, name, and price are required"); return; }
		setBusy(true);
		try {
			await upsertPackage({
				resort_property: resortProperty,
				code: form.code,
				package_name: form.package_name,
				nights: parseInt(form.nights, 10) || 2,
				package_price: parseFloat(form.package_price) || 0,
				inclusions: form.inclusions
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
					.map((name) => ({ inclusion_name: name, quantity: 1 })),
			});
			toast.success("Package saved");
			onSaved();
			onClose();
		} catch (err) {
			toast.error("Save failed", { description: err instanceof Error ? err.message : undefined });
		} finally {
			setBusy(false);
		}
	}
	return (
		<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Add package</SheetTitle>
					<SheetDescription>Bundles a fixed number of nights + inclusions into one price.</SheetDescription>
				</SheetHeader>
				<div className="mt-4 grid gap-3">
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5"><Label htmlFor="p-code">Code</Label><Input id="p-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="HNYMN" /></div>
						<div className="grid gap-1.5"><Label htmlFor="p-name">Name</Label><Input id="p-name" value={form.package_name} onChange={(e) => setForm({ ...form, package_name: e.target.value })} placeholder="Honeymoon Escape" /></div>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5"><Label htmlFor="p-nights">Nights</Label><Input id="p-nights" type="number" min="1" value={form.nights} onChange={(e) => setForm({ ...form, nights: e.target.value })} /></div>
						<div className="grid gap-1.5"><Label htmlFor="p-price">Package price (₹)</Label><Input id="p-price" type="number" min="0" value={form.package_price} onChange={(e) => setForm({ ...form, package_price: e.target.value })} placeholder="52000" /></div>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="p-incl">Inclusions (comma-separated)</Label>
						<Input id="p-incl" value={form.inclusions} onChange={(e) => setForm({ ...form, inclusions: e.target.value })} placeholder="Breakfast, Spa credit, Airport transfer" />
					</div>
				</div>
				<SheetFooter className="mt-4">
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Save package</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
