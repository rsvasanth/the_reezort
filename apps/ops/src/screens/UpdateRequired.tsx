import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { spacing } from "@reezort/ui";

/**
 * Screen: update required — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * Driven by `register_session` returning `ok: false`. There is no sign-out button
 * here on purpose: signing out wipes the outbox, and the drain-only grace exists
 * precisely so the work on this handset survives the upgrade.
 */
interface Props {
	readonly queued: number;
}

export function UpdateRequired({ queued }: Props) {
	return (
		<View style={styles.page}>
			<Text variant="headlineSmall">Update required</Text>
			<Text variant="bodyMedium" style={styles.body}>
				This version can no longer sync. Ask your supervisor for the new build.
			</Text>

			{queued > 0 ? (
				<Text variant="bodyMedium" style={styles.body}>
					{queued} change{queued === 1 ? "" : "s"} {queued === 1 ? "is" : "are"} still waiting to
					send. {queued === 1 ? "It" : "They"} will sync once you update — don't reinstall.
				</Text>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	page: { flex: 1, justifyContent: "center", padding: spacing.lg },
	body: { marginTop: spacing.md },
});
