import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
	Button,
	Dialog,
	Portal,
	RadioButton,
	Text,
	TextInput,
	TouchableRipple,
} from "react-native-paper";

import { spacing } from "@reezort/ui";

import {
	queueCompletionWithPhoto,
	queueDndOrRefused,
	queueTransition,
	type HousekeepingTask,
} from "../session";
import {
	availableTaskActions,
	completionBlockedReason,
	DND_CHOICES,
	dndLabel,
	type TaskAction,
} from "./taskActions";

/**
 * Screen: task detail — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * The screen where a round is actually finished. Its predecessor offered Start
 * and Pause and nothing else, so an attendant could open work and never close it.
 */
interface Props {
	readonly task: HousekeepingTask;
	readonly queued: boolean;
	readonly onQueued: (message: string) => void;
	readonly onBack: () => void;
}

export function TaskDetail({ task, queued, onQueued, onBack }: Props) {
	const [busy, setBusy] = useState(false);
	const [askingReason, setAskingReason] = useState(false);
	// Nothing preselected: the same rule the conflict screen is built on. A
	// default here is the app choosing a reason on the attendant's behalf.
	const [reason, setReason] = useState<"DND" | "Refused" | "Access Issue" | null>(null);
	const [note, setNote] = useState("");

	const actions = availableTaskActions(task);
	const blockedReason = completionBlockedReason(task);

	const run = async (action: TaskAction) => {
		if (action === "cantAccess") {
			setReason(null);
			setNote("");
			setAskingReason(true);
			return;
		}

		setBusy(true);
		try {
			if (action === "complete") {
				const captured = await queueCompletionWithPhoto(task);
				// Declining the camera is a choice, not a failure. Nothing is queued
				// and nothing is said.
				if (!captured) return;
				onQueued(`Room ${task.room} complete`);
				onBack();
				return;
			}
			await queueTransition(task, action === "start" ? "start_task" : "pause_task");
			onQueued(action === "start" ? `Started room ${task.room}` : `Paused room ${task.room}`);
			onBack();
		} finally {
			setBusy(false);
		}
	};

	const confirmReason = async () => {
		if (!reason) return;
		setBusy(true);
		try {
			await queueDndOrRefused(task, reason, note.trim() || undefined);
			setAskingReason(false);
			onQueued(`Room ${task.room} marked ${dndLabel(reason)?.toLowerCase()}`);
			onBack();
		} finally {
			setBusy(false);
		}
	};

	return (
		<ScrollView contentContainerStyle={styles.page}>
			<Text variant="headlineSmall">{task.task_type}</Text>
			<Text variant="bodyMedium" style={styles.muted}>
				{[task.task_status, task.priority, task.due_at ? `due ${timeOf(task.due_at)}` : null]
					.filter(Boolean)
					.join(" · ")}
			</Text>
			{/* Present because supervisors ask for it on the phone; muted because it
			    means nothing to the person doing the work. */}
			<Text variant="bodySmall" style={styles.faint}>
				{task.name}
			</Text>

			{blockedReason ? (
				<Text variant="bodyMedium" style={styles.blocked}>
					{blockedReason}
				</Text>
			) : null}

			<View style={styles.actions}>
				{actions.map((option) => (
					<Button
						key={option.action}
						mode={option.primary ? "contained" : "outlined"}
						disabled={busy}
						style={styles.action}
						onPress={() => void run(option.action)}
					>
						{option.label}
					</Button>
				))}
				{actions.length === 0 ? (
					<Text variant="bodySmall" style={styles.muted}>
						Nothing left to do on this one.
					</Text>
				) : null}
			</View>

			{queued ? (
				<Text variant="bodySmall" style={styles.muted}>
					Queued · will sync when you're back online
				</Text>
			) : null}

			<Portal>
				<Dialog visible={askingReason} onDismiss={() => setAskingReason(false)}>
					<Dialog.Title>Why can't the room be serviced?</Dialog.Title>
					<Dialog.Content>
						<RadioButton.Group
							onValueChange={(v) => setReason(v as typeof reason)}
							value={reason ?? ""}
						>
							{DND_CHOICES.map((choice) => (
								<TouchableRipple key={choice.value} onPress={() => setReason(choice.value)}>
									<View style={styles.choice}>
										<RadioButton value={choice.value} />
										<Text variant="bodyMedium" style={styles.choiceLabel}>
											{choice.label}
										</Text>
									</View>
								</TouchableRipple>
							))}
						</RadioButton.Group>
						<TextInput
							mode="outlined"
							label="Anything to add? (optional)"
							value={note}
							onChangeText={setNote}
							style={styles.note}
						/>
					</Dialog.Content>
					<Dialog.Actions>
						<Button onPress={() => setAskingReason(false)}>Cancel</Button>
						<Button mode="contained" disabled={!reason || busy} onPress={() => void confirmReason()}>
							Save
						</Button>
					</Dialog.Actions>
				</Dialog>
			</Portal>
		</ScrollView>
	);
}

/** A time, not a timestamp — nobody reads seconds off a wall. */
function timeOf(value: string): string {
	const parsed = new Date(value.replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
	page: { padding: spacing.md },
	muted: { opacity: 0.7, marginTop: spacing.xs },
	faint: { opacity: 0.4, marginTop: spacing.xs },
	blocked: { marginTop: spacing.md },
	actions: { marginTop: spacing.lg },
	action: { marginTop: spacing.sm },
	choice: { flexDirection: "row", alignItems: "center" },
	choiceLabel: { flexShrink: 1 },
	note: { marginTop: spacing.md },
});
