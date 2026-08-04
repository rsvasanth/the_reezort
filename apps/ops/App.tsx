import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, ClipboardCheck, RefreshCw, Wrench, type LucideIcon } from "lucide-react-native";
import { StatusBar } from "expo-status-bar";

import { Text } from "@reezort/ui";

import "./global.css";

import { SessionExpiredError } from "@reezort/api-client";
import type { OutboxSummary } from "@reezort/outbox";

import { login, LoginCancelled } from "./src/auth/login";
import { secureTokenStore } from "./src/auth/secureTokenStore";
import { oauthConfig } from "./src/config";
import { deleteLocalDatabase } from "./src/outbox/expoSqlite";
import { deleteAllPhotos } from "./src/photos";
import { ConflictReview } from "./src/screens/ConflictReview";
import { SignIn } from "./src/screens/SignIn";
import { SyncScreen } from "./src/screens/SyncScreen";
import { TaskDetail } from "./src/screens/TaskDetail";
import { TaskList } from "./src/screens/TaskList";
import { TicketDetail } from "./src/screens/TicketDetail";
import { TicketList } from "./src/screens/TicketList";
import { UpdateRequired } from "./src/screens/UpdateRequired";
import { isUnreachable, statusLine, syncBadgeCount, syncErrorCopy } from "./src/screens/syncStatus";
import {
	cache,
	cachedBoth,
	client,
	drainAll,
	loadLastSyncedAt,
	outbox,
	pullAll,
	queuedTargetNames,
	registerSession,
	saveLastSyncedAt,
	type HousekeepingTask,
	type MaintenanceTicket,
} from "./src/session";

/**
 * The ops app shell: auth gate, version gate, three destinations, one derived
 * sync state.
 *
 * What this replaced was a single scrolling page with the outbox counters at the
 * top — machinery promoted above the work. `ui-ux-ops-app.md` inverts that: the
 * round is the app, and the outbox appears on one screen, for when it is wrong.
 */
const APP_VERSION = "0.1.0";

type Tab = "tasks" | "work" | "sync";

export default function App() {
	const [booting, setBooting] = useState(true);
	const [user, setUser] = useState<string | null>(null);
	const [roles, setRoles] = useState<readonly string[]>([]);
	const [versionBlocked, setVersionBlocked] = useState(false);
	const [signingIn, setSigningIn] = useState(false);
	const [signInError, setSignInError] = useState<string | null>(null);

	const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
	const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
	const [queued, setQueued] = useState<Set<string>>(new Set());
	const [summary, setSummary] = useState<OutboxSummary | null>(null);

	const [syncing, setSyncing] = useState(false);
	const [unreachable, setUnreachable] = useState(false);
	const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

	const [tab, setTab] = useState<Tab>("tasks");
	const [openTask, setOpenTask] = useState<string | null>(null);
	const [openTicket, setOpenTicket] = useState<string | null>(null);
	const [reviewing, setReviewing] = useState(false);
	const [toast, setToast] = useState<string | null>(null);

	// Paper's Snackbar auto-dismissed via `duration`; ours is a plain view, so the
	// timer is explicit. Keyed on the message so a second toast restarts the clock
	// rather than inheriting the remainder of the first one's.
	useEffect(() => {
		if (toast === null) return undefined;
		const timer = setTimeout(() => setToast(null), 3000);
		return () => clearTimeout(timer);
	}, [toast]);

	/** Everything the screens render comes from the device, never from a response. */
	const readLocal = useCallback(async () => {
		const { tasks: t, tickets: k } = await cachedBoth();
		setTasks(t);
		setTickets(k);
		setQueued(await queuedTargetNames());
		setSummary(await outbox.summary());
	}, []);

	const sync = useCallback(async () => {
		setSyncing(true);
		try {
			await pullAll();
			await drainAll();
			const at = Date.now();
			setLastSyncedAt(at);
			await saveLastSyncedAt(at);
			setUnreachable(false);
		} catch (cause) {
			// A transport failure is the only offline signal that changes what the
			// attendant should do. A refusal is the server talking, and says nothing
			// about signal.
			setUnreachable(isUnreachable(cause));
			setToast(syncErrorCopy(cause));
		} finally {
			await readLocal();
			setSyncing(false);
		}
	}, [readLocal]);

	const boot = useCallback(async () => {
		try {
			await outbox.init();
			await cache.init();
			// The cached round renders before anything touches the network: an
			// attendant opening this in a corridor gets their work, not a spinner.
			await readLocal();
			setLastSyncedAt(await loadLastSyncedAt());

			const who = await client.call<string>("frappe.auth.get_logged_user");
			setUser(who);

			const session = await registerSession(APP_VERSION);
			setRoles(session.data?.roles ?? []);
			if (session.ok === false) {
				setVersionBlocked(true);
				return;
			}
			await sync();
		} catch (cause) {
			// No session yet is the ordinary cold start, not something to shout about.
			if (!(cause instanceof SessionExpiredError)) {
				setUnreachable(isUnreachable(cause));
			}
			setUser(null);
		} finally {
			setBooting(false);
		}
	}, [readLocal, sync]);

	useEffect(() => {
		void boot();
	}, [boot]);

	const onSignIn = async () => {
		setSigningIn(true);
		setSignInError(null);
		try {
			await secureTokenStore.save(await login(oauthConfig));
			setBooting(true);
			await boot();
		} catch (cause) {
			// Cancelling is a choice, not an error, and must not raise a banner.
			if (!(cause instanceof LoginCancelled)) {
				setSignInError(
					isUnreachable(cause)
						? "Can't reach the server. Check your connection and try again."
						: "That sign-in didn't work. Try again, or ask your supervisor.",
				);
			}
		} finally {
			setSigningIn(false);
		}
	};

	const wipe = async () => {
		await secureTokenStore.clear();
		// Drops the database file rather than deleting rows: SQLite leaves deleted
		// content in freed pages until they are reused, and AD-016-007 asks for
		// nothing readable left on a handset the resort does not own.
		await deleteLocalDatabase();
		// Queued readiness photos are guest-room imagery. They go with everything else.
		await deleteAllPhotos();
		setUser(null);
		setRoles([]);
		setTasks([]);
		setTickets([]);
		setSummary(null);
		setQueued(new Set());
		setReviewing(false);
		setOpenTask(null);
		setOpenTicket(null);
		setVersionBlocked(false);
		setTab("tasks");
	};

	const onSignOut = async () => {
		const pending = await outbox.summary();
		const unsent = pending.pending + pending.needsReview + pending.failed;
		if (unsent === 0) {
			await wipe();
			return;
		}
		// Queued work is never silently discarded. The attendant has to be told
		// what they are about to lose and say so explicitly.
		Alert.alert(
			"Sign out with unsynced work?",
			`${unsent} change${unsent === 1 ? "" : "s"} ${unsent === 1 ? "has" : "have"} not reached the server. Signing out deletes ${unsent === 1 ? "it" : "them"} for good.`,
			[
				{ text: "Stay signed in", style: "cancel" },
				{ text: "Sign out and lose them", style: "destructive", onPress: () => void wipe() },
			],
		);
	};

	const syncState = {
		neverSynced: lastSyncedAt === null,
		syncing,
		unreachable,
		lastSyncedAt,
		summary,
	};

	// Roles gate the tabs; the server still enforces every permission. Both are
	// shown when the user holds neither role, rather than an app with one empty
	// tab and no account of why.
	const hasHousekeeping = roles.includes("Housekeeping") || tasks.length > 0;
	const hasMaintenance = roles.includes("Maintenance") || tickets.length > 0;
	const showWork = hasMaintenance;
	const showTasks = hasHousekeeping || !hasMaintenance;

	const routes = useMemo(
		(): readonly { key: Tab; title: string; icon: LucideIcon; badge?: number }[] =>
			[
				showTasks ? { key: "tasks" as const, title: "Tasks", icon: ClipboardCheck } : null,
				showWork ? { key: "work" as const, title: "Work", icon: Wrench } : null,
				{
					key: "sync" as const,
					title: "Sync",
					icon: RefreshCw,
					badge: syncBadgeCount(summary) ?? undefined,
				},
			].filter((r): r is NonNullable<typeof r> => r !== null),
		[showTasks, showWork, summary],
	);

	// A tab can disappear underneath the selection — a housekeeping-only user
	// whose last ticket was reassigned away, for instance.
	useEffect(() => {
		const fallback = routes[0];
		if (fallback && !routes.some((r) => r.key === tab)) setTab(fallback.key as Tab);
	}, [routes, tab]);

	const task = tasks.find((t) => t.name === openTask) ?? null;
	const ticket = tickets.find((t) => t.name === openTicket) ?? null;
	const inDetail = task !== null || ticket !== null || reviewing;

	const back = () => {
		setOpenTask(null);
		setOpenTicket(null);
		setReviewing(false);
	};

	const afterQueue = async (message: string) => {
		setToast(message);
		await readLocal();
	};

	const title = task ? `Room ${task.room}` : ticket ? `Room ${ticket.room}` : "Reezort Ops";

	return (
		<SafeAreaProvider>
			<SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
				<View className="flex-1">
					{/* Was Paper's Appbar. A plain row: back affordance only where there
					    is somewhere to go back to, title, and the sync status line. */}
					<View className="h-14 flex-row items-center gap-2 border-b border-border px-2">
						{inDetail ? (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Back"
								onPress={back}
								className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
							>
								<ChevronLeft size={24} className="text-foreground" />
							</Pressable>
						) : null}
						<Text className="flex-1 px-2 text-lg font-medium" numberOfLines={1}>
							{title}
						</Text>
						{user && !versionBlocked ? (
							<Text className="mr-2 text-sm text-muted-foreground">{statusLine(syncState)}</Text>
						) : null}
					</View>

					{booting ? (
						<ActivityIndicator className="mt-12" size="large" />
					) : !user ? (
						<SignIn busy={signingIn} error={signInError} onSignIn={() => void onSignIn()} />
					) : versionBlocked ? (
						<UpdateRequired queued={summary?.pending ?? 0} />
					) : (
						<>
							<View className="flex-1">
								{task ? (
									<TaskDetail
										task={task}
										queued={queued.has(task.name)}
										onQueued={(m) => void afterQueue(m)}
										onBack={back}
									/>
								) : ticket ? (
									<TicketDetail
										ticket={ticket}
										queued={queued.has(ticket.name)}
										onQueued={(m) => void afterQueue(m)}
										onBack={back}
									/>
								) : reviewing ? (
									<ConflictReview
										onResolved={() => void afterQueue("Resolved. It'll sync on the next round.")}
										onClose={back}
									/>
								) : tab === "tasks" ? (
									<TaskList
										tasks={tasks}
										hasEverSynced={lastSyncedAt !== null}
										refreshing={syncing}
										onRefresh={() => void sync()}
										onOpen={(t) => setOpenTask(t.name)}
										queuedFor={(name) => queued.has(name)}
									/>
								) : tab === "work" ? (
									<TicketList
										tickets={tickets}
										hasEverSynced={lastSyncedAt !== null}
										refreshing={syncing}
										onRefresh={() => void sync()}
										onOpen={(t) => setOpenTicket(t.name)}
										queuedFor={(name) => queued.has(name)}
									/>
								) : (
									<SyncScreen
										state={syncState}
										now={Date.now()}
										user={user}
										onSyncNow={() => void sync()}
										onReview={() => setReviewing(true)}
										onSignOut={() => void onSignOut()}
									/>
								)}
							</View>

							{inDetail ? null : (
								// Was BottomNavigation.Bar. Each destination is a 48px-tall
								// target with its badge drawn inline, so the queue depth is
								// visible from the round rather than only on the sync screen.
								<View className="flex-row border-t border-border">
									{routes.map((route) => {
										const active = route.key === tab;
										const Icon = route.icon;
										return (
											<Pressable
												key={route.key}
												accessibilityRole="tab"
												accessibilityState={{ selected: active }}
												onPress={() => setTab(route.key)}
												className="min-h-[56px] flex-1 items-center justify-center gap-0.5 py-2 active:opacity-70"
											>
												<View>
													<Icon
														size={22}
														className={active ? "text-primary" : "text-muted-foreground"}
													/>
													{route.badge ? (
														<View className="absolute -right-2.5 -top-1 min-w-[16px] items-center rounded-full bg-primary px-1">
															<Text className="text-[10px] text-primary-foreground">
																{route.badge}
															</Text>
														</View>
													) : null}
												</View>
												<Text
													className={
														active
															? "text-xs font-medium text-primary"
															: "text-xs text-muted-foreground"
													}
												>
													{route.title}
												</Text>
											</Pressable>
										);
									})}
								</View>
							)}
						</>
					)}

					{/* Was Paper's Snackbar in a Portal. Absolutely positioned above the
					    tab bar; dismissal is the timer effect above, or a tap. */}
					{toast !== null ? (
						<Pressable
							onPress={() => setToast(null)}
							className="absolute bottom-20 left-4 right-4 rounded-md bg-foreground px-4 py-3"
						>
							<Text className="text-background">{toast}</Text>
						</Pressable>
					) : null}
					<StatusBar style="auto" />
				</View>
			</SafeAreaView>
		</SafeAreaProvider>
	);
}
