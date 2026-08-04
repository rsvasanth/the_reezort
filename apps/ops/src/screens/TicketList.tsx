import { Pressable, View } from "react-native";

import { Badge, Card, CardContent, Text } from "@reezort/ui";

import type { MaintenanceTicket } from "../session";
import { Sections } from "./Sections";
import { rowTitle, ticketSections, ticketsEmptyCopy } from "./listSections";
import { shouldShowPriority } from "./taskActions";

/**
 * Screen: maintenance work — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * `maintenance_tickets` was already served by `sync_pull`; until now the client
 * simply never requested the collection, so the role had a backend and no app.
 *
 * The row is a Pressable wrapping a Card rather than a Card with an `onPress`,
 * so `Card` stays the plain container it is on web. Tapping is a screen concern.
 */
interface Props {
	readonly tickets: readonly MaintenanceTicket[];
	readonly hasEverSynced: boolean;
	readonly refreshing: boolean;
	readonly onRefresh: () => void;
	readonly onOpen: (ticket: MaintenanceTicket) => void;
	readonly queuedFor: (name: string) => boolean;
}

export function TicketList({
	tickets,
	hasEverSynced,
	refreshing,
	onRefresh,
	onOpen,
	queuedFor,
}: Props) {
	return (
		<Sections
			sections={ticketSections(tickets)}
			keyOf={(t) => t.name}
			emptyCopy={ticketsEmptyCopy(hasEverSynced, tickets.length)}
			refreshing={refreshing}
			onRefresh={onRefresh}
			renderItem={(ticket) => (
				<Pressable className="mt-2 active:opacity-70" onPress={() => onOpen(ticket)}>
					<Card>
						<CardContent className="gap-1 p-4">
							<Text className="font-medium">{rowTitle(ticket.room, "Ticket")}</Text>
							<View className="flex-row gap-1">
								<Text className="text-sm text-muted-foreground">{ticket.state}</Text>
								{queuedFor(ticket.name) ? (
									<Text className="text-sm text-muted-foreground">· queued</Text>
								) : null}
							</View>
							{shouldShowPriority(ticket.priority) ? (
								<Badge variant="secondary" className="mt-1">
									<Text>{ticket.priority}</Text>
								</Badge>
							) : null}
						</CardContent>
					</Card>
				</Pressable>
			)}
		/>
	);
}
