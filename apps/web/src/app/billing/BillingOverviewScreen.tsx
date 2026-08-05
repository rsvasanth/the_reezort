/**
 * Billing — overview ledger of invoices + payments (over ERPNext). Read-only,
 * finance/management gated. Mount inside <AppShell>.
 */

import { useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/components/folio/folio-format";
import { FolioApiError, getBillingOverview, type BillingOverview } from "@/lib/billing-overview-api";

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
	Paid: "secondary",
	Overdue: "destructive",
	Unpaid: "outline",
	"Partly Paid": "outline",
};

export default function BillingOverviewScreen() {
	const [data, setData] = useState<BillingOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [denied, setDenied] = useState(false);

	useEffect(() => {
		getBillingOverview()
			.then(setData)
			.catch((error) => {
				if (error instanceof FolioApiError && error.status === 403) setDenied(true);
			})
			.finally(() => setLoading(false));
	}, []);

	const cur = data?.currency ?? "INR";

	return (
		<WorkspacePage title="Billing overview" subtitle="Folios, postings and outstanding balances." testId="billing-screen">
			<header>
				<Badge variant="outline" className="mb-2">Billing</Badge>
				<h1 className="text-3xl font-light text-foreground md:text-4xl">Billing</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Invoices, payments, and outstanding across the resort — straight from the ledger.
				</p>
			</header>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : denied ? (
				<Card><CardContent className="py-8 text-sm text-muted-foreground">
					You do not have permission to view billing. Ask finance or a manager.
				</CardContent></Card>
			) : data ? (
				<>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="billing-summary">
						<Stat label="Invoiced" value={formatCurrency(data.summary.invoiced, cur)} />
						<Stat label="Collected" value={formatCurrency(data.summary.collected, cur)} />
						<Stat label="Outstanding" value={formatCurrency(data.summary.outstanding, cur)} danger={data.summary.outstanding > 0} />
						<Stat label="Invoices" value={String(data.summary.invoice_count)} />
					</div>

					<Tabs defaultValue="invoices">
						<TabsList>
							<TabsTrigger value="invoices" data-testid="tab-invoices">Invoices</TabsTrigger>
							<TabsTrigger value="payments" data-testid="tab-payments">Payments</TabsTrigger>
						</TabsList>

						<TabsContent value="invoices" className="mt-4">
							<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Invoice</TableHead>
											<TableHead>Customer</TableHead>
											<TableHead>Date</TableHead>
											<TableHead className="text-right">Total</TableHead>
											<TableHead className="text-right">Outstanding</TableHead>
											<TableHead>Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.invoices.length === 0 ? (
											<TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No invoices yet.</TableCell></TableRow>
										) : (
											data.invoices.map((inv) => (
												<TableRow key={inv.name}>
													<TableCell className="font-medium">{inv.name}</TableCell>
													<TableCell className="text-sm">{inv.customer}</TableCell>
													<TableCell className="text-sm">{inv.posting_date ?? "—"}</TableCell>
													<TableCell className="text-right">{formatCurrency(inv.grand_total, inv.currency)}</TableCell>
													<TableCell className="text-right">{formatCurrency(inv.outstanding_amount, inv.currency)}</TableCell>
													<TableCell><Badge variant={STATUS_VARIANT[inv.status] ?? "outline"}>{inv.status}</Badge></TableCell>
												</TableRow>
											))
										)}
									</TableBody>
								</Table>
							</div>
						</TabsContent>

						<TabsContent value="payments" className="mt-4">
							<div className="rounded-lg border border-border/60 bg-[var(--card-surface)]">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Payment</TableHead>
											<TableHead>Party</TableHead>
											<TableHead>Date</TableHead>
											<TableHead className="text-right">Amount</TableHead>
											<TableHead>Mode</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.payments.length === 0 ? (
											<TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No payments yet.</TableCell></TableRow>
										) : (
											data.payments.map((p) => (
												<TableRow key={p.name}>
													<TableCell className="font-medium">{p.name}</TableCell>
													<TableCell className="text-sm">{p.party}</TableCell>
													<TableCell className="text-sm">{p.posting_date ?? "—"}</TableCell>
													<TableCell className="text-right">{formatCurrency(p.paid_amount, cur)}</TableCell>
													<TableCell className="text-sm">{p.mode_of_payment ?? "—"}</TableCell>
												</TableRow>
											))
										)}
									</TableBody>
								</Table>
							</div>
						</TabsContent>
					</Tabs>
				</>
			) : null}
		</WorkspacePage>
	);
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
	return (
		<div className="rounded-lg border bg-card p-3">
			<div className={`text-xl font-semibold ${danger ? "text-destructive" : ""}`}>{value}</div>
			<div className="text-xs text-muted-foreground">{label}</div>
		</div>
	);
}
