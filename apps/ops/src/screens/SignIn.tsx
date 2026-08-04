import { ActivityIndicator, View } from "react-native";

import { Button, Text } from "@reezort/ui";

/**
 * Screen: sign in — `specs/016-mobile-apps/ui-ux-ops-app.md`.
 *
 * Deliberately bare. The previous build printed the API base URL, the OAuth
 * client id and the redirect URI in a footer on every screen; on a BYOD handset
 * that tells whoever is holding the phone exactly which host to point at.
 *
 * Paper's Button had a `loading` prop; ours does not, because a spinner is a
 * child rather than a variant. Busy state is `disabled` plus an ActivityIndicator
 * in the slot, which also keeps the button width stable while it spins.
 */
interface Props {
	readonly busy: boolean;
	readonly error: string | null;
	readonly onSignIn: () => void;
}

export function SignIn({ busy, error, onSignIn }: Props) {
	return (
		<View className="flex-1 items-center justify-center gap-2 bg-background p-6">
			<Text className="text-2xl font-semibold">Reezort Ops</Text>
			<Text className="text-center text-muted-foreground">
				Sign in with your resort account
			</Text>

			{error ? <Text className="mt-2 text-center text-danger">{error}</Text> : null}

			<Button className="mt-8 min-w-[200px]" disabled={busy} onPress={onSignIn}>
				{busy ? <ActivityIndicator /> : <Text>Sign in</Text>}
			</Button>
		</View>
	);
}
