import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { spacing } from "@reezort/ui";

/**
 * Guest app shell. Reezort-brand surfaces land in Phase 5 (booking, in-room
  * dining, service requests, folio).
 */
export default function App() {
	return (
		<View style={styles.container}>
			<Text style={styles.title}>Reezort</Text>
			<Text style={styles.subtitle}>Your stay</Text>
			<StatusBar style="auto" />
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
	title: { fontSize: 24, fontWeight: "600" },
	subtitle: { marginTop: spacing.sm, opacity: 0.6 },
});
