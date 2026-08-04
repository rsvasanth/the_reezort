import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { Button, Separator, Text } from "@reezort/ui";

import { lastSyncedLabel, syncRows, type SyncState } from "./syncStatus";

/**
 * Screen: sync — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * The only screen that shows machinery, because it is the only screen for when
 * something is wrong. Everywhere else, the outbox is invisible.
 *
 * Paper's List.Item is replaced by a plain Pressable row; the chevron is drawn
 * only for rows that actually navigate, which is what `row.navigates` has always
 * meant.
 */
interface Props {
	readonly state: SyncState;
	readonly now: number;
	readonly user: string | null;
	readonly onSyncNow: () => void;
	readonly onReview: () => void;
	readonly onSignOut: () => void;
}

export function SyncScreen({ state, now, user, onSyncNow, onReview, onSignOut }: Props) {
	const rows = syncRows(state.summary);

	return (
		<ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
			{/* The headline, because it is the question being asked. */}
			<Text className="text-base font-medium">{lastSyncedLabel(state.lastSyncedAt, now)}</Text>

			<Button className="mb-6 mt-4" disabled={state.syncing} onPress={onSyncNow}>
				{state.syncing ? <ActivityIndicator /> : <Text>Sync now</Text>}
			</Button>

			{rows.length === 0 ? (
				<Text className="text-sm text-muted-foreground">
					Everything on this phone has reached the server.
				</Text>
			) : null}

			{rows.map((row) =>
				row.navigates ? (
					<Pressable
						key={row.key}
						onPress={onReview}
						className="flex-row items-center justify-between py-3 active:opacity-70"
					>
						<Text className={row.emphasis ? undefined : "text-muted-foreground"}>
							{row.label}
						</Text>
						<ChevronRight size={20} className="text-muted-foreground" />
					</Pressable>
				) : (
					<View key={row.key} className="py-3">
						<Text className={row.emphasis ? undefined : "text-muted-foreground"}>
							{row.label}
						</Text>
					</View>
				),
			)}

			<Separator className="mt-6" />

			<View className="mt-4 gap-1">
				<Text className="text-sm text-muted-foreground">Signed in as {user ?? "—"}</Text>
				{/* Rare and destructive, so it lives here rather than one thumb-slip
				    from the round. */}
				<Button variant="ghost" className="self-start px-0" onPress={onSignOut}>
					<Text>Sign out</Text>
				</Button>
			</View>
		</ScrollView>
	);
}
