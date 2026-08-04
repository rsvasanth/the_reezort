import { StyleSheet, View } from "react-native";
import { Card, Chip, Text } from "react-native-paper";

import { spacing } from "@reezort/ui";

import type { HousekeepingTask } from "../session";
import { Sections } from "./Sections";
import { rowTitle, taskSections, tasksEmptyCopy } from "./listSections";
import { dndLabel, isReadOnly, shouldShowPriority } from "./taskActions";

/**
 * Screen: the round — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * The room leads every row, because that is what the attendant walks to. The
 * task name is a supervisor's handle and lives on detail, not here.
 */
interface Props {
	readonly tasks: readonly HousekeepingTask[];
	readonly hasEverSynced: boolean;
	readonly refreshing: boolean;
	readonly onRefresh: () => void;
	readonly onOpen: (task: HousekeepingTask) => void;
	readonly queuedFor: (name: string) => boolean;
}

export function TaskList({
	tasks,
	hasEverSynced,
	refreshing,
	onRefresh,
	onOpen,
	queuedFor,
}: Props) {
	const remaining = tasks.filter((t) => !isReadOnly(t)).length;

	return (
		<Sections
			sections={taskSections(tasks)}
			keyOf={(t) => t.name}
			emptyCopy={tasksEmptyCopy(hasEverSynced, tasks.length, remaining)}
			refreshing={refreshing}
			onRefresh={onRefresh}
			renderItem={(task) => {
				const blocked = dndLabel(task.dnd_status);
				return (
					<Card style={styles.card} mode="outlined" onPress={() => onOpen(task)}>
						<Card.Content>
							<Text variant="titleMedium">{rowTitle(task.room, task.task_type)}</Text>
							<View style={styles.meta}>
								<Text variant="bodySmall" style={styles.muted}>
									{blocked ? `${task.task_status} · ${blocked}` : task.task_status}
								</Text>
								{queuedFor(task.name) ? (
									<Text variant="bodySmall" style={styles.muted}>
										· queued
									</Text>
								) : null}
							</View>
							{/* A chip on every row would hide the urgent ones. */}
							{shouldShowPriority(task.priority) ? (
								<Chip compact style={styles.chip}>
									{task.priority}
								</Chip>
							) : null}
						</Card.Content>
					</Card>
				);
			}}
		/>
	);
}

const styles = StyleSheet.create({
	card: { marginTop: spacing.sm },
	meta: { flexDirection: "row", gap: spacing.xs, marginTop: 2 },
	chip: { alignSelf: "flex-start", marginTop: spacing.sm },
	muted: { opacity: 0.7 },
});
