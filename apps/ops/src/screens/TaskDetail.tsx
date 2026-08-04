import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

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
 *
 * The reason picker is composed here rather than promoted to `@reezort/ui`: the
 * web design system has no RadioGroup, and adding one on native only would break
 * the mirroring that Rule 5 exists to protect. It is a single-select list, which
 * is a screen concern.
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
		<ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
			<Text className="text-xl font-semibold">{task.task_type}</Text>
			<Text className="mt-1 text-muted-foreground">
				{[task.task_status, task.priority, task.due_at ? `due ${timeOf(task.due_at)}` : null]
					.filter(Boolean)
					.join(" · ")}
			</Text>
			{/* Present because supervisors ask for it on the phone; muted because it
			    means nothing to the person doing the work. */}
			<Text className="mt-1 text-sm text-muted-foreground/60">{task.name}</Text>

			{blockedReason ? <Text className="mt-4 text-warning">{blockedReason}</Text> : null}

			<View className="mt-6 gap-2">
				{actions.map((option) => (
					<Button
						key={option.action}
						variant={option.primary ? "default" : "outline"}
						disabled={busy}
						onPress={() => void run(option.action)}
					>
						<Text>{option.label}</Text>
					</Button>
				))}
				{actions.length === 0 ? (
					<Text className="text-sm text-muted-foreground">Nothing left to do on this one.</Text>
				) : null}
			</View>

			{queued ? (
				<Text className="mt-4 text-sm text-muted-foreground">
					Queued · will sync when you're back online
				</Text>
			) : null}

			<Dialog open={askingReason} onOpenChange={setAskingReason}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Why can't the room be serviced?</DialogTitle>
					</DialogHeader>

					<View className="gap-1">
						{DND_CHOICES.map((choice) => {
							const selected = reason === choice.value;
							return (
								<Pressable
									key={choice.value}
									accessibilityRole="radio"
									accessibilityState={{ selected }}
									onPress={() => setReason(choice.value)}
									className="flex-row items-center gap-3 py-2 active:opacity-70"
								>
									<View
										className={
											selected
												? "h-5 w-5 items-center justify-center rounded-full border-2 border-primary"
												: "h-5 w-5 rounded-full border-2 border-muted-foreground/50"
										}
									>
										{selected ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
									</View>
									<Text className="shrink">{choice.label}</Text>
								</Pressable>
							);
						})}
					</View>

					<Input
						value={note}
						onChangeText={setNote}
						placeholder="Anything to add? (optional)"
					/>

					<DialogFooter>
						<Button variant="ghost" onPress={() => setAskingReason(false)}>
							<Text>Cancel</Text>
						</Button>
						<Button disabled={!reason || busy} onPress={() => void confirmReason()}>
							<Text>Save</Text>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ScrollView>
	);
}

/** A time, not a timestamp — nobody reads seconds off a wall. */
function timeOf(value: string): string {
	const parsed = new Date(value.replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
