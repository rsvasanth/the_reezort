import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import { Separator, Text } from "@reezort/ui";

import type { Section } from "./listSections";

/**
 * The list scaffolding both tabs share: grouped rows, pull-to-refresh, and one
 * sentence when there is nothing to show.
 *
 * An arrangement of shared primitives, not a new design-system component — it
 * composes `@reezort/ui` rather than authoring anything visual of its own.
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
			className="flex-1 bg-background"
			contentContainerClassName="p-4 pb-8"
			refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
		>
			{sections.length === 0 ? (
				<View className="items-center pt-16">
					<Text className="text-center text-muted-foreground">{emptyCopy}</Text>
				</View>
			) : null}

			{sections.map((section) => (
				<View key={section.title} className="mb-6">
					<Pressable
						className="active:opacity-70"
						onPress={() =>
							setCollapsed((prev) => ({ ...prev, [section.title]: !isCollapsed(section) }))
						}
					>
						<View className="flex-row items-center justify-between py-2">
							<Text className="text-sm font-medium">{section.title}</Text>
							<Text className="text-sm text-muted-foreground">
								{isCollapsed(section) ? `${section.items.length} ▾` : section.items.length}
							</Text>
						</View>
					</Pressable>
					<Separator />
					{isCollapsed(section)
						? null
						: section.items.map((item) => <View key={keyOf(item)}>{renderItem(item)}</View>)}
				</View>
			))}
		</ScrollView>
	);
}
