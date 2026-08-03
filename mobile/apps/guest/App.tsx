import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Text } from "@reezort/ui";

import "./global.css";

/**
 * Guest app shell. The real Reezort-brand surfaces (booking, in-room dining,
 * service requests, folio) land in Phase 5.
 *
 * What this currently renders is a deliberate smoke test of the design system
 * end to end: NativeWind classes → the `@reezort/tokens` variables → the shared
 * `@reezort/ui` components. If the brass and ivory below look right, the whole
 * native pipeline is wired correctly.
 */
export default function App() {
	return (
		<SafeAreaProvider>
			<SafeAreaView className="flex-1 bg-background">
				<View className="flex-1 justify-center gap-4 p-6">
					<View className="gap-1">
						<Text className="font-display text-3xl text-foreground">Reezort</Text>
						<Text className="text-sm text-muted-foreground">Your stay</Text>
					</View>

					<Card>
						<CardHeader>
							<CardTitle>Design system</CardTitle>
							<CardDescription>
								Brand tokens rendering through NativeWind.
							</CardDescription>
						</CardHeader>
						<CardContent className="gap-3">
							<View className="flex-row gap-2">
								<Badge>
									<Text>Brass</Text>
								</Badge>
								<Badge variant="secondary">
									<Text>Sand</Text>
								</Badge>
								<Badge variant="outline">
									<Text>Ink</Text>
								</Badge>
							</View>
							<Button>
								<Text>Primary action</Text>
							</Button>
							<Button variant="outline">
								<Text>Secondary action</Text>
							</Button>
						</CardContent>
					</Card>
				</View>
				<StatusBar style="auto" />
			</SafeAreaView>
		</SafeAreaProvider>
	);
}
