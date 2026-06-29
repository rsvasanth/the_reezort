import { AlertTriangle, IdCard, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { readOnlyBannerCopy } from "./folio-format";
import type { FolioStatus } from "@/lib/folio-api";

export function FolioLoadingState() {
	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-7 w-48" />
						<Skeleton className="h-4 w-64" />
						<Skeleton className="h-4 w-40" />
					</div>
					<div className="flex flex-col gap-2">
						<Skeleton className="h-6 w-44" />
						<Skeleton className="h-9 w-32" />
					</div>
					<div className="flex flex-col items-end gap-2">
						<Skeleton className="h-6 w-24" />
						<Skeleton className="h-6 w-24" />
						<Skeleton className="h-6 w-24" />
					</div>
				</CardContent>
			</Card>
			<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
				{Array.from({ length: 5 }).map((_, i) => (
					<Card key={i}>
						<CardContent className="p-4">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="mt-3 h-6 w-28" />
						</CardContent>
					</Card>
				))}
			</div>
			<Card>
				<CardContent className="p-0">
					{Array.from({ length: 8 }).map((_, i) => (
						<div key={i} className="flex items-center gap-4 border-b px-6 py-3 last:border-b-0">
							<Skeleton className="h-4 w-1/3" />
							<Skeleton className="h-4 w-1/6 ml-auto" />
							<Skeleton className="h-4 w-1/6" />
							<Skeleton className="h-4 w-1/6" />
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	);
}

export function FolioErrorState({
	message,
	onRetry,
	onBack,
}: {
	message: string;
	onRetry: () => void;
	onBack: () => void;
}) {
	return (
		<Card className="border-destructive/40">
			<CardContent className="flex flex-col items-center gap-3 p-12 text-center">
				<div className="rounded-full bg-destructive/10 p-3 text-destructive">
					<AlertTriangle className="size-6" />
				</div>
				<div className="text-lg font-semibold">Couldn't load folio</div>
				<p className="max-w-md text-sm text-muted-foreground">{message}</p>
				<div className="mt-2 flex gap-2">
					<Button onClick={onRetry}>Retry</Button>
					<Button variant="outline" onClick={onBack}>
						Back to workspace
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

export function FolioNoSelectionState({ onBack }: { onBack: () => void }) {
	return (
		<Card>
			<CardContent className="flex flex-col items-center gap-3 p-12 text-center">
				<div className="rounded-full bg-muted p-3">
					<IdCard className="size-6 text-muted-foreground" />
				</div>
				<div className="text-lg font-semibold">No folio selected</div>
				<p className="max-w-md text-sm text-muted-foreground">
					Open a folio from arrivals, departures, or the checkout-readiness card.
				</p>
				<Button onClick={onBack}>Open Folio Workspace</Button>
			</CardContent>
		</Card>
	);
}

export function ReadOnlyBanner({ status }: { status: FolioStatus }) {
	const copy = readOnlyBannerCopy(status);
	if (!copy) return null;
	return (
		<div className="flex items-center gap-3 rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
			<Lock className="size-4 shrink-0" />
			<span>{copy}</span>
		</div>
	);
}
