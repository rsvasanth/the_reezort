import {
	BedDoubleIcon,
	CalendarCheckIcon,
	ClipboardListIcon,
	IndianRupeeIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

const cards = [
	{
		label: "Tonight occupancy",
		value: "82%",
		badge: "+6%",
		footer: "148 of 180 sellable rooms are occupied or due in.",
		icon: BedDoubleIcon,
	},
	{
		label: "Projected room revenue",
		value: "₹18.4L",
		badge: "Today",
		footer: "Room revenue forecast from direct, OTA, and corporate channels.",
		icon: IndianRupeeIcon,
	},
	{
		label: "Arrivals",
		value: "46",
		badge: "9 VIP",
		footer: "Expected arrivals, early check-ins, and airport pickup watchlist.",
		icon: CalendarCheckIcon,
	},
	{
		label: "Open exceptions",
		value: "11",
		badge: "3 urgent",
		footer: "Housekeeping, maintenance, guest request, and billing follow-ups.",
		icon: ClipboardListIcon,
	},
];

export function SectionCards() {
	return (
		<div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-none sm:grid-cols-2 xl:grid-cols-4 lg:px-6">
			{cards.map((card) => (
				<Card key={card.label}>
					<CardHeader className="relative">
						<CardDescription className="pr-20">{card.label}</CardDescription>
						<CardTitle className="text-2xl font-light tabular-nums sm:text-3xl">
							{card.value}
						</CardTitle>
						<div className="absolute right-4 top-4">
							<Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
								<card.icon className="size-3" />
								{card.badge}
							</Badge>
						</div>
					</CardHeader>
					<CardFooter className="flex-col items-start gap-1 text-sm text-muted-foreground">
						{card.footer}
					</CardFooter>
				</Card>
			))}
		</div>
	);
}
