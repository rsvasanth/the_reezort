import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Dialog, Portal, Text, TextInput } from "react-native-paper";

import { spacing } from "@reezort/ui";

import { queueTicketTransition, type MaintenanceTicket } from "../session";
import { availableTransitions, type TicketTransition } from "./ticketActions";

/**
 * Screen: ticket detail — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * Offers exactly the transitions `STATE_TRANSITIONS` allows from the current
 * state. The mirror lives in `ticketActions.ts`, tested against the server map.
 */
interface Props {
	readonly ticket: MaintenanceTicket;
	readonly queued: boolean;
	readonly onQueued: (message: string) => void;
	readonly onBack: () => void;
}

export function TicketDetail({ ticket, queued, onQueued, onBack }: Props) {
	const [busy, setBusy] = useState(false);
	const [asking, setAsking] = useState<TicketTransition | null>(null);
	const [note, setNote] = useState("");

	const transitions = availableTransitions(ticket);

	const apply = async (transition: TicketTransition, notes?: string) => {
		setBusy(true);
		try {
			await queueTicketTransition(ticket, transition.next, notes);
			setAsking(null);
			onQueued(`Room ${ticket.room} · ${transition.label.toLowerCase()}`);
			onBack();
		} finally {
			setBusy(false);
		}
	};

	const start = (transition: TicketTransition) => {
		// A resolution with no account of what was done is worth less than none,
		// and the server files these as resolution_notes.
		if (transition.wantsNote) {
			setNote("");
			setAsking(transition);
			return;
		}
		void apply(transition);
	};

	return (
		<ScrollView contentContainerStyle={styles.page}>
			<Text variant="headlineSmall">Room {ticket.room}</Text>
			<Text variant="bodyMedium" style={styles.muted}>
				{ticket.state} · {ticket.priority}
			</Text>
			<Text variant="bodySmall" style={styles.faint}>
				{ticket.name}
			</Text>

			<View style={styles.actions}>
				{transitions.map((transition) => (
					<Button
						key={transition.next}
						mode={transition.primary ? "contained" : "outlined"}
						disabled={busy}
						style={styles.action}
						onPress={() => start(transition)}
					>
						{transition.label}
					</Button>
				))}
				{transitions.length === 0 ? (
					<Text variant="bodySmall" style={styles.muted}>
						This ticket is closed.
					</Text>
				) : null}
			</View>

			{queued ? (
				<Text variant="bodySmall" style={styles.muted}>
					Queued · will sync when you're back online
				</Text>
			) : null}

			<Portal>
				<Dialog visible={asking !== null} onDismiss={() => setAsking(null)}>
					<Dialog.Title>{asking?.label}</Dialog.Title>
					<Dialog.Content>
						<Text variant="bodyMedium">What was done?</Text>
						<TextInput
							mode="outlined"
							label="Notes"
							value={note}
							onChangeText={setNote}
							multiline
							style={styles.note}
						/>
					</Dialog.Content>
					<Dialog.Actions>
						<Button onPress={() => setAsking(null)}>Cancel</Button>
						<Button
							mode="contained"
							disabled={busy || note.trim().length === 0}
							onPress={() => asking && void apply(asking, note.trim())}
						>
							Save
						</Button>
					</Dialog.Actions>
				</Dialog>
			</Portal>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	page: { padding: spacing.md },
	muted: { opacity: 0.7, marginTop: spacing.xs },
	faint: { opacity: 0.4, marginTop: spacing.xs },
	actions: { marginTop: spacing.lg },
	action: { marginTop: spacing.sm },
	note: { marginTop: spacing.sm },
});
