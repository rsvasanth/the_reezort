import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { needsReview, type OutboxRow } from "@reezort/outbox";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Separator,
	Text,
	cn,
} from "@reezort/ui";

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
 *
 * Selection was a runtime `useTheme()` lookup under Paper; it is now a class
 * swap. Same intent — the chosen card carries a 2px primary border — expressed
 * through the token layer rather than a theme object.
 */
interface Props {
	readonly onResolved: () => void;
	readonly onClose: () => void;
}

export function ConflictReview({ onResolved, onClose }: Props) {
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

	if (busy) return <ActivityIndicator className="mt-4" size="large" />;

	if (!row) {
		return (
			<Card className="mt-4">
				<CardContent className="gap-3 p-4">
					<Text>Nothing needs review.</Text>
					<Button variant="ghost" className="self-start px-0" onPress={onClose}>
						<Text>Back</Text>
					</Button>
				</CardContent>
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

	const selected = (which: "mine" | "theirs") =>
		choice === which ? "border-2 border-primary" : "border border-border";

	return (
		<View>
			<View className="flex-row items-baseline justify-between">
				<Text className="text-base font-medium">Needs review</Text>
				<Text className="text-sm text-muted-foreground">
					{index + 1} of {rows.length}
				</Text>
			</View>

			{row.state === "refused" ? (
				// Distinct from a conflict on purpose: the attendant already decided
				// about this row, and re-presenting it as a fresh conflict makes them
				// re-litigate a decision they have made.
				<Card className="mt-3 bg-muted">
					<CardContent className="gap-1 p-4">
						<Text className="text-sm font-medium">The server refused that change</Text>
						<Text className="text-sm text-muted-foreground">
							{row.lastError ?? "No reason given."}
						</Text>
					</CardContent>
				</Card>
			) : (
				<Card className="mt-3 bg-muted">
					<CardContent className="gap-1 p-4">
						<Text className="text-sm font-medium">{bannerHeadline(row, subject)}</Text>
						<Text className="text-sm text-muted-foreground">{bannerBody(row, subject)}</Text>
					</CardContent>
				</Card>
			)}

			<Pressable className="mt-2.5" onPress={() => setChoice("mine")}>
				<Card className={cn("rounded-xl", selected("mine"))}>
					<CardHeader className="p-4 pb-2">
						<CardTitle>Yours</CardTitle>
						<CardDescription>{new Date(row.createdAt).toLocaleTimeString()}</CardDescription>
					</CardHeader>
					<CardContent className="p-4 pt-0">
						{fields.map((f) => (
							<View key={f.label} className="flex-row justify-between py-0.5">
								<Text className="text-muted-foreground">{f.label}</Text>
								<Text>{f.mine ?? "—"}</Text>
							</View>
						))}
						{photos > 0 ? (
							<Text className="mt-1 text-sm text-muted-foreground">
								{photos} photo{photos === 1 ? "" : "s"} waiting to upload
							</Text>
						) : null}
					</CardContent>
				</Card>
			</Pressable>

			<Pressable className="mt-2.5" onPress={() => setChoice("theirs")}>
				<Card className={cn("rounded-xl", selected("theirs"))}>
					<CardHeader className="p-4 pb-2">
						<CardTitle>On the server</CardTitle>
						<CardDescription>{row.conflict?.serverModified ?? ""}</CardDescription>
					</CardHeader>
					<CardContent className="p-4 pt-0">
						{fields.map((f) => (
							<View key={f.label} className="flex-row justify-between py-0.5">
								<Text className="text-muted-foreground">{f.label}</Text>
								<Text>{f.theirs ?? "—"}</Text>
							</View>
						))}
					</CardContent>
				</Card>
			</Pressable>

			<Text className="mt-3 min-h-[40px] text-sm text-muted-foreground">
				{consequence(choice, row, subject, photos)}
			</Text>

			{/* Disabled until a version is chosen. A preselected default is
			    auto-resolution with extra steps, which the contract forbids. */}
			<Button className="mt-2" disabled={!choice} onPress={resolve}>
				<Text>{primaryLabel(choice, row)}</Text>
			</Button>
			<Button
				variant="outline"
				className="mt-2"
				onPress={() => (index + 1 < rows.length ? setIndex(index + 1) : onClose())}
			>
				<Text>Decide later</Text>
			</Button>
			<Separator className="mt-4" />
		</View>
	);
}
