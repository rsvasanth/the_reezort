import { StyleSheet, View } from "react-native";
import { Card, Chip, Text } from "react-native-paper";

import { spacing } from "@reezort/ui";

import type { MaintenanceTicket } from "../session";
import { Sections } from "./Sections";
import { rowTitle, ticketSections, ticketsEmptyCopy } from "./listSections";
import { shouldShowPriority } from "./taskActions";

/**
 * Screen: maintenance work — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * `maintenance_tickets` was already served by `sync_pull`; until now the client
 * simply never requested the collection, so the role had a backend and no app.
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
				<Card style={styles.card} mode="outlined" onPress={() => onOpen(ticket)}>
					<Card.Content>
						<Text variant="titleMedium">{rowTitle(ticket.room, "Ticket")}</Text>
						<View style={styles.meta}>
							<Text variant="bodySmall" style={styles.muted}>
								{ticket.state}
							</Text>
							{queuedFor(ticket.name) ? (
								<Text variant="bodySmall" style={styles.muted}>
									· queued
								</Text>
							) : null}
						</View>
						{shouldShowPriority(ticket.priority) ? (
							<Chip compact style={styles.chip}>
								{ticket.priority}
							</Chip>
						) : null}
					</Card.Content>
				</Card>
			)}
		/>
	);
}

const styles = StyleSheet.create({
	card: { marginTop: spacing.sm },
	meta: { flexDirection: "row", gap: spacing.xs, marginTop: 2 },
	chip: { alignSelf: "flex-start", marginTop: spacing.sm },
	muted: { opacity: 0.7 },
});
