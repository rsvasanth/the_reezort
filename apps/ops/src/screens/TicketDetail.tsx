import { useState } from "react";
import { ScrollView, View } from "react-native";

import {
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Text,
} from "@reezort/ui";

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
		<ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
			<Text className="text-xl font-semibold">Room {ticket.room}</Text>
			<Text className="mt-1 text-muted-foreground">
				{ticket.state} · {ticket.priority}
			</Text>
			<Text className="mt-1 text-sm text-muted-foreground/60">{ticket.name}</Text>

			<View className="mt-6 gap-2">
				{transitions.map((transition) => (
					<Button
						key={transition.next}
						variant={transition.primary ? "default" : "outline"}
						disabled={busy}
						onPress={() => start(transition)}
					>
						<Text>{transition.label}</Text>
					</Button>
				))}
				{transitions.length === 0 ? (
					<Text className="text-sm text-muted-foreground">This ticket is closed.</Text>
				) : null}
			</View>

			{queued ? (
				<Text className="mt-4 text-sm text-muted-foreground">
					Queued · will sync when you're back online
				</Text>
			) : null}

			<Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{asking?.label}</DialogTitle>
					</DialogHeader>
					<Text>What was done?</Text>
					<Input
						value={note}
						onChangeText={setNote}
						multiline
						placeholder="Notes"
						className="h-24 py-2"
						textAlignVertical="top"
					/>
					<DialogFooter>
						<Button variant="ghost" onPress={() => setAsking(null)}>
							<Text>Cancel</Text>
						</Button>
						<Button
							disabled={busy || note.trim().length === 0}
							onPress={() => asking && void apply(asking, note.trim())}
						>
							<Text>Save</Text>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ScrollView>
	);
}
