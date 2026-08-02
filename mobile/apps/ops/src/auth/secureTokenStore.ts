/**
 * TokenStore backed by expo-secure-store (Android Keystore).
 *
 * AD-016-002 and AD-016-007: tokens live in the Keystore and never in
 * AsyncStorage. On a personal handset the app's plain storage is readable by
 * anyone who gets the phone unlocked, and by any backup agent.
 */
import * as SecureStore from "expo-secure-store";

import type { TokenSet, TokenStore } from "@reezort/api-client";

const KEY = "reezort.ops.tokens";

export const secureTokenStore: TokenStore = {
	async load() {
		const raw = await SecureStore.getItemAsync(KEY);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as TokenSet;
		} catch {
			// Corrupt entry is indistinguishable from no session. Drop it rather than
			// crashing the app on every launch.
			await SecureStore.deleteItemAsync(KEY);
			return null;
		}
	},

	async save(tokens: TokenSet) {
		await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
	},

	async clear() {
		await SecureStore.deleteItemAsync(KEY);
	},
};
