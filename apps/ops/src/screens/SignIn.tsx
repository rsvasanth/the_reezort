import { StyleSheet, View } from "react-native";
import { Button, Text } from "react-native-paper";

import { spacing } from "@reezort/ui";

/**
 * Screen: sign in — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * Deliberately bare. The previous build printed the API base URL, the OAuth
 * client id and the redirect URI in a footer on every screen; on a BYOD handset
 * that tells whoever is holding the phone exactly which host to point at.
 */
interface Props {
	readonly busy: boolean;
	readonly error: string | null;
	readonly onSignIn: () => void;
}

export function SignIn({ busy, error, onSignIn }: Props) {
	return (
		<View style={styles.page}>
			<Text variant="headlineMedium">Reezort Ops</Text>
			<Text variant="bodyMedium" style={styles.muted}>
				Sign in with your resort account
			</Text>

			{error ? (
				<Text variant="bodyMedium" style={styles.error}>
					{error}
				</Text>
			) : null}

			<Button mode="contained" style={styles.action} loading={busy} disabled={busy} onPress={onSignIn}>
				Sign in
			</Button>
		</View>
	);
}

const styles = StyleSheet.create({
	page: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg },
	muted: { opacity: 0.7, marginTop: spacing.sm, textAlign: "center" },
	error: { marginTop: spacing.md, textAlign: "center" },
	action: { marginTop: spacing.xl, minWidth: 200 },
});
