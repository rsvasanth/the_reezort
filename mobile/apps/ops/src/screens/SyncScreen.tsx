import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Divider, List, Text } from "react-native-paper";

import { spacing } from "@reezort/ui";

import { lastSyncedLabel, syncRows, type SyncState } from "./syncStatus";

/**
 * Screen: sync — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * The only screen that shows machinery, because it is the only screen for when
 * something is wrong. Everywhere else, the outbox is invisible.
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
		<ScrollView contentContainerStyle={styles.page}>
			{/* The headline, because it is the question being asked. */}
			<Text variant="titleMedium">{lastSyncedLabel(state.lastSyncedAt, now)}</Text>

			<Button
				mode="contained"
				style={styles.sync}
				loading={state.syncing}
				disabled={state.syncing}
				onPress={onSyncNow}
			>
				Sync now
			</Button>

			{rows.length === 0 ? (
				<Text variant="bodySmall" style={styles.muted}>
					Everything on this phone has reached the server.
				</Text>
			) : null}

			{rows.map((row) => (
				<List.Item
					key={row.key}
					title={row.label}
					titleStyle={row.emphasis ? undefined : styles.muted}
					right={row.navigates ? (props) => <List.Icon {...props} icon="chevron-right" /> : undefined}
					onPress={row.navigates ? onReview : undefined}
				/>
			))}

			<Divider style={styles.divider} />

			<View style={styles.account}>
				<Text variant="bodySmall" style={styles.muted}>
					Signed in as {user ?? "—"}
				</Text>
				{/* Rare and destructive, so it lives here rather than one thumb-slip
				    from the round. */}
				<Button onPress={onSignOut} style={styles.signOut}>
					Sign out
				</Button>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	page: { padding: spacing.md },
	sync: { marginTop: spacing.md, marginBottom: spacing.lg },
	muted: { opacity: 0.7 },
	divider: { marginTop: spacing.lg },
	account: { marginTop: spacing.md },
	signOut: { alignSelf: "flex-start", marginTop: spacing.xs },
});
