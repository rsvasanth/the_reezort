import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
	ActivityIndicator,
	Button,
	Card,
	Chip,
	MD3LightTheme,
	PaperProvider,
	Text,
} from "react-native-paper";
import { StatusBar } from "expo-status-bar";

import { createClient, SessionExpiredError } from "@reezort/api-client";

import { login, LoginCancelled } from "./src/auth/login";
import { secureTokenStore } from "./src/auth/secureTokenStore";
import { oauthConfig } from "./src/config";

/**
 * Phase 1 shell: proves the PKCE round trip against the bench on a real handset.
 *
 * Material 3 components are consumed as shipped (AD-016-008) — no restyling, no
 * Reezort branding. The housekeeping surfaces land in Phase 3.
 */

const client = createClient(oauthConfig, secureTokenStore, fetch);

interface Session {
	readonly user: string;
	readonly roles: readonly string[];
}

export default function App() {
	const [busy, setBusy] = useState(true);
	const [session, setSession] = useState<Session | null>(null);
	const [error, setError] = useState<string | null>(null);

	const loadSession = useCallback(async () => {
		setError(null);
		try {
			const user = await client.call<string>("frappe.auth.get_logged_user");
			const roles = await client.call<readonly string[]>("frappe.core.doctype.user.user.get_roles");
			setSession({ user, roles });
		} catch (cause) {
			// No session yet is the normal cold-start path, not a failure worth showing.
			if (!(cause instanceof SessionExpiredError)) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
			setSession(null);
		} finally {
			setBusy(false);
		}
	}, []);

	useEffect(() => {
		void loadSession();
	}, [loadSession]);

	const onSignIn = async () => {
		setBusy(true);
		setError(null);
		try {
			await secureTokenStore.save(await login(oauthConfig));
			await loadSession();
		} catch (cause) {
			if (!(cause instanceof LoginCancelled)) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
			setBusy(false);
		}
	};

	const onSignOut = async () => {
		await secureTokenStore.clear();
		setSession(null);
	};

	return (
		<SafeAreaProvider>
			<PaperProvider theme={MD3LightTheme}>
				<ScrollView contentContainerStyle={styles.page}>
					<Text variant="headlineMedium">Reezort Ops</Text>
					<Text variant="bodyMedium" style={styles.subtitle}>
						Staff operations · offline-first
					</Text>

					{busy ? (
						<ActivityIndicator style={styles.block} size="large" />
					) : session ? (
						<Card style={styles.block} mode="outlined">
							<Card.Title title="Signed in" subtitle={session.user} />
							<Card.Content>
								<View style={styles.chips}>
									{session.roles.map((role) => (
										<Chip key={role} compact style={styles.chip}>
											{role}
										</Chip>
									))}
								</View>
								<Text variant="bodySmall" style={styles.note}>
									Authenticated with OAuth2 + PKCE. The token is held in the Android Keystore.
								</Text>
							</Card.Content>
							<Card.Actions>
								<Button onPress={onSignOut}>Sign out</Button>
							</Card.Actions>
						</Card>
					) : (
						<Card style={styles.block} mode="outlined">
							<Card.Content>
								<Text variant="bodyMedium">
									Sign in with your Reezort account to load your tasks.
								</Text>
							</Card.Content>
							<Card.Actions>
								<Button mode="contained" onPress={onSignIn}>
									Sign in
								</Button>
							</Card.Actions>
						</Card>
					)}

					{error ? (
						<Card style={styles.block} mode="outlined">
							<Card.Content>
								<Text variant="labelLarge">Sign-in failed</Text>
								<Text variant="bodySmall" style={styles.note}>
									{error}
								</Text>
							</Card.Content>
						</Card>
					) : null}

					{/* Shown on purpose: the redirect URI differs between Expo Go and a
					    real build, and Frappe rejects any it was not told about. Seeing
					    the actual value beats guessing at a 400. Drops out in Phase 3. */}
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
	page: { flexGrow: 1, justifyContent: "center", padding: 24 },
	subtitle: { marginTop: 4, opacity: 0.7 },
	block: { marginTop: 24 },
	chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
	chip: { marginRight: 0 },
	note: { opacity: 0.7 },
	footer: { marginTop: 24, opacity: 0.4, textAlign: "center" },
});
