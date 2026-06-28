import {
	BadgeCheckIcon,
	BedDoubleIcon,
	Building2Icon,
	ClipboardCheckIcon,
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
		label: "Production site",
		value: "Live",
		badge: "HTTPS",
		footer: "app.thereezort.com is running behind nginx and Supervisor.",
		icon: BadgeCheckIcon,
	},
	{
		label: "First sprint",
		value: "Property",
		badge: "001",
		footer: "Buildings, floors, room types, rooms, amenities, and room state.",
		icon: Building2Icon,
	},
	{
		label: "Core boundary",
		value: "ERPNext",
		badge: "Ledger",
		footer: "Finance, HR, stock, purchase, assets, and sales posting remain standard.",
		icon: ClipboardCheckIcon,
	},
	{
		label: "Parked scope",
		value: "Spa",
		badge: "007",
		footer: "Spa and ancillary services stay outside year-one operation.",
		icon: BedDoubleIcon,
	},
];

export function SectionCards() {
	return (
		<div className="*:data-[slot=card]:shadow-none @xl/main:grid-cols-2 @5xl/main:grid-cols-4 grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card lg:px-6">
			{cards.map((card) => (
				<Card key={card.label} className="@container/card">
					<CardHeader className="relative">
						<CardDescription>{card.label}</CardDescription>
						<CardTitle className="@[250px]/card:text-3xl text-2xl font-light tabular-nums tracking-[-0.03em]">
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
