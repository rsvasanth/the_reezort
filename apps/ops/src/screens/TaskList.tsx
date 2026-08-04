import { Pressable, View } from "react-native";

import { Badge, Card, CardContent, Text } from "@reezort/ui";

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
					<Pressable className="mt-2 active:opacity-70" onPress={() => onOpen(task)}>
						<Card>
							<CardContent className="gap-1 p-4">
								<Text className="font-medium">{rowTitle(task.room, task.task_type)}</Text>
								<View className="flex-row gap-1">
									<Text className="text-sm text-muted-foreground">
										{blocked ? `${task.task_status} · ${blocked}` : task.task_status}
									</Text>
									{queuedFor(task.name) ? (
										<Text className="text-sm text-muted-foreground">· queued</Text>
									) : null}
								</View>
								{/* A chip on every row would hide the urgent ones. */}
								{shouldShowPriority(task.priority) ? (
									<Badge variant="secondary" className="mt-1">
										<Text>{task.priority}</Text>
									</Badge>
								) : null}
							</CardContent>
						</Card>
					</Pressable>
				);
			}}
		/>
	);
}
