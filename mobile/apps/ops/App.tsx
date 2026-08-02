import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { spacing } from "@reezort/ui";

/**
 * Ops app shell. Material 3 surfaces land in Phase 3 (housekeeping task list,
 * room status, camera capture, the conflict "needs review" screen).
 */
export default function App() {
	return (
		<View style={styles.container}>
			<Text style={styles.title}>Reezort Ops</Text>
			<Text style={styles.subtitle}>Staff operations · offline-first</Text>
			<StatusBar style="auto" />
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
	title: { fontSize: 24, fontWeight: "600" },
	subtitle: { marginTop: spacing.sm, opacity: 0.6 },
});
