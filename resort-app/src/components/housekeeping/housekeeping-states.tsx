import { AlertTriangle, BedDouble, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function HousekeepingLoadingState() {
	return (
		<div className="flex flex-col gap-6">
			{/* Simulated two buildings with floors */}
			{[0, 1].map((b) => (
				<div key={b} className="flex flex-col gap-3">
					<Skeleton className="h-5 w-36" />
					{[0, 1].map((f) => (
						<div key={f} className="flex flex-col gap-2">
							<Skeleton className="h-4 w-24" />
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								{Array.from({ length: 3 }).map((_, i) => (
									<Card key={i}>
										<CardContent className="p-4">
											<div className="flex items-start justify-between gap-2">
												<Skeleton className="h-5 w-16" />
												<Skeleton className="h-5 w-20" />
											</div>
											<Skeleton className="mt-2 h-4 w-28" />
											<div className="mt-3 flex gap-2">
												<Skeleton className="h-6 w-16 rounded-full" />
												<Skeleton className="h-6 w-16 rounded-full" />
											</div>
											<Skeleton className="mt-3 h-8 w-full" />
										</CardContent>
									</Card>
								))}
							</div>
						</div>
					))}
				</div>
			))}
		</div>
	);
}

export function HousekeepingErrorState({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<Card className="border-destructive/40">
			<CardContent className="flex flex-col items-center gap-3 p-12 text-center">
				<div className="rounded-full bg-destructive/10 p-3 text-destructive">
					<AlertTriangle className="size-6" />
				</div>
				<div className="text-lg font-semibold">Couldn't load housekeeping board</div>
				<p className="max-w-md text-sm text-muted-foreground">{message}</p>
				<Button onClick={onRetry} className="mt-2">
					<RefreshCw className="mr-2 size-4" />
					Retry
				</Button>
			</CardContent>
		</Card>
	);
}

export function HousekeepingEmptyState() {
	return (
		<Card>
			<CardContent className="flex flex-col items-center gap-3 p-12 text-center">
				<div className="rounded-full bg-muted p-3">
					<BedDouble className="size-6 text-muted-foreground" />
				</div>
				<div className="text-lg font-semibold">No rooms found</div>
				<p className="max-w-md text-sm text-muted-foreground">
					No rooms are configured for this property yet.
				</p>
			</CardContent>
		</Card>
	);
}
