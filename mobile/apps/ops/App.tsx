import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
	ActivityIndicator,
	Badge,
	Button,
	Card,
	Chip,
	Divider,
	MD3LightTheme,
	PaperProvider,
	Text,
} from "react-native-paper";
import { StatusBar } from "expo-status-bar";

import { SessionExpiredError } from "@reezort/api-client";
import type { OutboxSummary } from "@reezort/outbox";

import { login, LoginCancelled } from "./src/auth/login";
import { secureTokenStore } from "./src/auth/secureTokenStore";
import { oauthConfig } from "./src/config";
import { deleteLocalDatabase } from "./src/outbox/expoSqlite";
import {
	client,
	drain,
	outbox,
	pullTasks,
	queueTransition,
	registerSession,
	type HousekeepingTask,
} from "./src/session";

/**
 * Phase 1/3 skeleton: sign in, see your tasks, queue a transition offline, drain
 * it. Enough to exercise the whole path end to end on a handset.
 *
 * Material 3 components are consumed as shipped (AD-016-008) — no restyling.
 * The proper task list, camera capture and conflict review screens land next.
 */
const APP_VERSION = "0.1.0";

export default function App() {
	const [busy, setBusy] = useState(true);
	const [user, setUser] = useState<string | null>(null);
	const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
	const [summary, setSummary] = useState<OutboxSummary | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refreshSummary = useCallback(async () => {
		setSummary(await outbox.summary());
	}, []);

	const load = useCallback(async () => {
		setError(null);
		try {
			await outbox.init();
			const who = await client.call<string>("frappe.auth.get_logged_user");
			setUser(who);
			await registerSession(APP_VERSION);
			setTasks(await pullTasks());
			await refreshSummary();
		} catch (cause) {
			// No session yet is the normal cold start, not something to shout about.
			if (!(cause instanceof SessionExpiredError)) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
			setUser(null);
		} finally {
			setBusy(false);
		}
	}, [refreshSummary]);

	useEffect(() => {
		void load();
	}, [load]);

	const onSignIn = async () => {
		setBusy(true);
		setError(null);
		try {
			await secureTokenStore.save(await login(oauthConfig));
			await load();
		} catch (cause) {
			if (!(cause instanceof LoginCancelled)) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
			setBusy(false);
		}
	};

	const onSignOut = async () => {
		// AD-016-007: nothing readable survives on a handset the resort does not
		// own. A non-empty outbox must warn first — that confirmation lands with
		// the real logout flow; this skeleton reports the loss instead of hiding it.
		const pending = await outbox.summary();
		await secureTokenStore.clear();
		await deleteLocalDatabase();
		setUser(null);
		setTasks([]);
		setSummary(null);
		setNote(pending.pending ? `Signed out with ${pending.pending} unsynced` : null);
	};

	const onQueue = async (task: HousekeepingTask) => {
		const action = task.task_status === "In Progress" ? "pause_task" : "start_task";
		await queueTransition(task, action);
		await refreshSummary();
		setNote(`Queued ${action.replace("_", " ")} for ${task.name}`);
	};

	const onDrain = async () => {
		setBusy(true);
		try {
			const results = await drain();
			const counts = results.reduce<Record<string, number>>(
				(acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
				{},
			);
			setNote(
				results.length
					? Object.entries(counts)
							.map(([status, n]) => `${n} ${status.toLowerCase()}`)
							.join(" · ")
					: "Nothing to sync",
			);
			setTasks(await pullTasks());
			await refreshSummary();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<SafeAreaProvider>
			<PaperProvider theme={MD3LightTheme}>
				<ScrollView contentContainerStyle={styles.page}>
					<Text variant="headlineMedium">Reezort Ops</Text>
					<Text variant="bodySmall" style={styles.muted}>
						{user ?? "Not signed in"}
					</Text>

					{busy ? <ActivityIndicator style={styles.block} size="large" /> : null}

					{!busy && !user ? (
						<Card style={styles.block} mode="outlined">
							<Card.Content>
								<Text variant="bodyMedium">Sign in to load your tasks.</Text>
							</Card.Content>
							<Card.Actions>
								<Button mode="contained" onPress={onSignIn}>
									Sign in
								</Button>
							</Card.Actions>
						</Card>
					) : null}

					{user ? (
						<>
							<Card style={styles.block} mode="outlined">
								<Card.Title
									title="Outbox"
									subtitle={
										summary
											? `${summary.pending} queued · ${summary.needsReview} needs review · ${summary.failed} failed`
											: "—"
									}
								/>
								<Card.Actions>
									<Button onPress={onDrain}>Sync now</Button>
									<Button onPress={onSignOut}>Sign out</Button>
								</Card.Actions>
							</Card>

							<Text variant="titleMedium" style={styles.block}>
								My tasks
							</Text>
							{tasks.length === 0 ? (
								<Text variant="bodySmall" style={styles.muted}>
									Nothing assigned to you.
								</Text>
							) : null}
							{tasks.map((task) => (
								<Card key={task.name} style={styles.card} mode="outlined">
									<Card.Title
										title={task.task_type}
										subtitle={`${task.room} · ${task.name}`}
									/>
									<Card.Content>
										<View style={styles.chips}>
											<Chip compact>{task.task_status}</Chip>
											<Chip compact>{task.priority}</Chip>
										</View>
									</Card.Content>
									<Card.Actions>
										<Button onPress={() => onQueue(task)}>
											{task.task_status === "In Progress" ? "Pause" : "Start"}
										</Button>
									</Card.Actions>
								</Card>
							))}
						</>
					) : null}

					{note ? (
						<>
							<Divider style={styles.block} />
							<Text variant="bodySmall" style={styles.muted}>
								{note}
							</Text>
						</>
					) : null}

					{error ? (
						<Card style={styles.block} mode="outlined">
							<Card.Content>
								<Text variant="labelLarge">Something went wrong</Text>
								<Text variant="bodySmall" style={styles.muted}>
									{error}
								</Text>
							</Card.Content>
						</Card>
					) : null}

					<Text variant="bodySmall" style={styles.footer}>
						{oauthConfig.baseUrl}
						{"\n"}
						{oauthConfig.redirectUri}
					</Text>
					<StatusBar style="auto" />
				</ScrollView>
			</PaperProvider>
		</SafeAreaProvider>
	);
}

const styles = StyleSheet.create({
	page: { flexGrow: 1, justifyContent: "center", padding: 20 },
	muted: { opacity: 0.7 },
	block: { marginTop: 20 },
	card: { marginTop: 10 },
	chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	footer: { marginTop: 24, opacity: 0.4, textAlign: "center" },
});
