import {
	AlertTriangleIcon,
	BedDoubleIcon,
	CalendarCheckIcon,
	ClipboardListIcon,
	IndianRupeeIcon,
	RefreshCwIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export type SectionCard = {
	label: string;
	value: string;
	badge: string;
	footer: string;
};

const iconByLabel = {
	"Tonight occupancy": BedDoubleIcon,
	"Projected room revenue": IndianRupeeIcon,
	"Sellable rooms": BedDoubleIcon,
	Arrivals: CalendarCheckIcon,
	"Room types": CalendarCheckIcon,
	"Open exceptions": ClipboardListIcon,
};

function getCardIcon(label: string) {
	return iconByLabel[label as keyof typeof iconByLabel] ?? ClipboardListIcon;
}

export function SectionCards({
	cards,
	onRetry,
}: {
	cards?: SectionCard[];
	onRetry?: () => void;
}) {
	if (!cards) {
		return (
			<div className="px-4 lg:px-6">
				<Card className="border-destructive/40">
					<CardContent className="flex flex-col items-center gap-3 p-8 text-center">
						<div className="rounded-full bg-destructive/10 p-3 text-destructive">
							<AlertTriangleIcon className="size-6" />
						</div>
						<div className="text-lg font-semibold">Couldn't load live dashboard data</div>
						<p className="max-w-md text-sm text-muted-foreground">
							The management dashboard snapshot didn't load. These figures are not shown to
							avoid displaying stale or fabricated numbers — retry to fetch live data.
						</p>
						{onRetry ? (
							<Button onClick={onRetry} className="mt-2">
								<RefreshCwIcon className="mr-2 size-4" />
								Retry
							</Button>
						) : null}
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-none sm:grid-cols-2 xl:grid-cols-4 lg:px-6">
			{cards.map((card) => {
				const Icon = "icon" in card ? card.icon : getCardIcon(card.label);

				return (
					<Card key={card.label}>
						<CardHeader className="relative">
							<CardDescription className="pr-20">{card.label}</CardDescription>
							<CardTitle className="text-2xl font-light tabular-nums sm:text-3xl">
								{card.value}
							</CardTitle>
							<div className="absolute right-4 top-4">
								<Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
									<Icon className="size-3" />
									{card.badge}
								</Badge>
							</div>
						</CardHeader>
						<CardFooter className="flex-col items-start gap-1 text-sm text-muted-foreground">
							{card.footer}
						</CardFooter>
					</Card>
				);
			})}
		</div>
	);
}
