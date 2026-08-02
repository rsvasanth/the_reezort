import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, Button, Card, Divider, Text, useTheme } from "react-native-paper";

import { needsReview, type OutboxRow } from "@reezort/outbox";

import { outbox } from "../session";
import {
	bannerBody,
	bannerHeadline,
	comparedFields,
	consequence,
	primaryLabel,
} from "./conflictCopy";

/**
 * Screen: Needs review — `specs/016-mobile-apps/ui-ux-conflict-review.md`.
 *
 * The only screen in the module where a design mistake destroys work rather than
 * causing annoyance, so the three rules from the spec are load-bearing:
 * nothing is preselected, the primary action names its outcome instead of saying
 * "Confirm", and the consequence line says what happens to the queued photo.
 */
interface Props {
	readonly onResolved: () => void;
	readonly onClose: () => void;
}

export function ConflictReview({ onResolved, onClose }: Props) {
	const theme = useTheme();
	const [rows, setRows] = useState<OutboxRow[]>([]);
	const [index, setIndex] = useState(0);
	const [choice, setChoice] = useState<"mine" | "theirs" | null>(null);
	const [photos, setPhotos] = useState(0);
	const [busy, setBusy] = useState(true);

	const row = rows[index];

	const load = useCallback(async () => {
		const all = (await outbox.list()).filter((r) => needsReview(r.state));
		setRows(all);
		setBusy(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		// A fresh item is a fresh decision: never carry a selection across.
		setChoice(null);
		if (!row) return;
		void outbox.uploadsFor(row.id).then((queued) => setPhotos(queued.length));
	}, [row]);

	if (busy) return <ActivityIndicator style={styles.block} size="large" />;

	if (!row) {
		return (
			<Card style={styles.block} mode="outlined">
				<Card.Content>
					<Text variant="bodyMedium">Nothing needs review.</Text>
				</Card.Content>
				<Card.Actions>
					<Button onPress={onClose}>Back</Button>
				</Card.Actions>
			</Card>
		);
	}

	const subject = row.targetName ?? "This record";
	const fields = comparedFields(row);

	const resolve = async () => {
		if (!choice) return;
		setBusy(true);
		if (choice === "theirs") {
			// Drops the row and its queued photos together — they can never attach
			// to a write that no longer exists.
			await outbox.resolveKeepServer(row.id);
		} else {
			await outbox.resolveKeepMine(row.id, () => globalThis.crypto.randomUUID());
		}
		setIndex(0);
		await load();
		onResolved();
	};

	const selected = (which: "mine" | "theirs") => ({
		borderColor: choice === which ? theme.colors.primary : theme.colors.outlineVariant,
		borderWidth: choice === which ? 2 : 1,
	});

	return (
		<View>
			<View style={styles.header}>
				<Text variant="titleMedium">Needs review</Text>
				<Text variant="bodySmall" style={styles.muted}>
					{index + 1} of {rows.length}
				</Text>
			</View>

			{row.state === "refused" ? (
				// Distinct from a conflict on purpose: the attendant already decided
				// about this row, and re-presenting it as a fresh conflict makes them
				// re-litigate a decision they have made.
				<Card style={styles.banner} mode="contained">
					<Card.Content>
						<Text variant="titleSmall">The server refused that change</Text>
						<Text variant="bodySmall">{row.lastError ?? "No reason given."}</Text>
					</Card.Content>
				</Card>
			) : (
				<Card style={styles.banner} mode="contained">
					<Card.Content>
						<Text variant="titleSmall">{bannerHeadline(row, subject)}</Text>
						<Text variant="bodySmall" style={styles.bannerBody}>
							{bannerBody(row, subject)}
						</Text>
					</Card.Content>
				</Card>
			)}

			<Card style={[styles.card, selected("mine")]} mode="outlined" onPress={() => setChoice("mine")}>
				<Card.Title title="Yours" subtitle={new Date(row.createdAt).toLocaleTimeString()} />
				<Card.Content>
					{fields.map((f) => (
						<View key={f.label} style={styles.row}>
							<Text variant="bodyMedium" style={styles.muted}>
								{f.label}
							</Text>
							<Text variant="bodyMedium">{f.mine ?? "—"}</Text>
						</View>
					))}
					{photos > 0 ? (
						<Text variant="bodySmall" style={styles.muted}>
							{photos} photo{photos === 1 ? "" : "s"} waiting to upload
						</Text>
					) : null}
				</Card.Content>
			</Card>

			<Card
				style={[styles.card, selected("theirs")]}
				mode="outlined"
				onPress={() => setChoice("theirs")}
			>
				<Card.Title title="On the server" subtitle={row.conflict?.serverModified ?? ""} />
				<Card.Content>
					{fields.map((f) => (
						<View key={f.label} style={styles.row}>
							<Text variant="bodyMedium" style={styles.muted}>
								{f.label}
							</Text>
							<Text variant="bodyMedium">{f.theirs ?? "—"}</Text>
						</View>
					))}
				</Card.Content>
			</Card>

			<Text variant="bodySmall" style={styles.consequence}>
				{consequence(choice, row, subject, photos)}
			</Text>

			{/* Disabled until a version is chosen. A preselected default is
			    auto-resolution with extra steps, which the contract forbids. */}
			<Button mode="contained" disabled={!choice} onPress={resolve} style={styles.action}>
				{primaryLabel(choice, row)}
			</Button>
			<Button
				onPress={() => (index + 1 < rows.length ? setIndex(index + 1) : onClose())}
				style={styles.action}
			>
				Decide later
			</Button>
			<Divider style={styles.block} />
		</View>
	);
}

const styles = StyleSheet.create({
	header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
	banner: { marginTop: 12 },
	bannerBody: { marginTop: 4 },
	card: { marginTop: 10, borderRadius: 12 },
	row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
	consequence: { marginTop: 12, minHeight: 40, opacity: 0.8 },
	action: { marginTop: 8 },
	block: { marginTop: 16 },
	muted: { opacity: 0.7 },
});
