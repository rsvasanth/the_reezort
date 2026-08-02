/**
 * PkceCrypto backed by expo-crypto.
 *
 * `packages/api-client` takes these injected so it can be unit-tested under
 * Node; this is the Android half.
 */
import * as Crypto from "expo-crypto";

import type { PkceCrypto } from "@reezort/api-client";

export const expoCrypto: PkceCrypto = {
	randomBytes: (length: number) => Crypto.getRandomBytes(length),

	sha256: async (input: string) => {
		// Ask for base64 and decode it: the hex variant would need re-parsing, and
		// `digestStringAsync` has no raw-bytes mode.
		const base64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
			encoding: Crypto.CryptoEncoding.BASE64,
		});
		const binary = atob(base64);
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	},
};
