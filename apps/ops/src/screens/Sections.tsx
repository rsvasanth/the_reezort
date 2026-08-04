import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Divider, Text, TouchableRipple } from "react-native-paper";

import { spacing } from "@reezort/ui";

import type { Section } from "./listSections";

/**
 * The list scaffolding both tabs share: grouped rows, pull-to-refresh, and one
 * sentence when there is nothing to show.
 *
 * Composition of Material 3 primitives, not a new component in the design-system
 * sense — AD-016-008 forbids authoring visual components, not arranging them.
 */
interface Props<T> {
	readonly sections: readonly Section<T>[];
	readonly renderItem: (item: T) => React.ReactNode;
	readonly keyOf: (item: T) => string;
	readonly emptyCopy: string;
	readonly refreshing: boolean;
	readonly onRefresh: () => void;
}

export function Sections<T>({
	sections,
	renderItem,
	keyOf,
	emptyCopy,
	refreshing,
	onRefresh,
}: Props<T>) {
	// Collapsed state is keyed by title so it survives a refresh reordering the
	// sections — an attendant who folded "Done" away should not have it spring
	// open every time a sync lands.
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(sections.map((s) => [s.title, s.collapsedByDefault])),
	);

	const isCollapsed = (s: Section<T>) => collapsed[s.title] ?? s.collapsedByDefault;

	return (
		<ScrollView
			contentContainerStyle={styles.page}
			refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
		>
			{sections.length === 0 ? (
				<View style={styles.empty}>
					<Text variant="bodyMedium" style={styles.muted}>
						{emptyCopy}
					</Text>
				</View>
			) : null}

			{sections.map((section) => (
				<View key={section.title} style={styles.section}>
					<TouchableRipple
						onPress={() =>
							setCollapsed((prev) => ({ ...prev, [section.title]: !isCollapsed(section) }))
						}
					>
						<View style={styles.heading}>
							<Text variant="titleSmall">{section.title}</Text>
							<Text variant="bodySmall" style={styles.muted}>
								{isCollapsed(section) ? `${section.items.length} ▾` : section.items.length}
							</Text>
						</View>
					</TouchableRipple>
					<Divider />
					{isCollapsed(section)
						? null
						: section.items.map((item) => <View key={keyOf(item)}>{renderItem(item)}</View>)}
				</View>
			))}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	page: { padding: spacing.md, paddingBottom: spacing.xl },
	section: { marginBottom: spacing.lg },
	heading: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingVertical: spacing.sm,
	},
	empty: { paddingTop: spacing.xl * 2, alignItems: "center" },
	muted: { opacity: 0.6 },
});
