import { describe, expect, it } from "vitest";

import { base64UrlEncode, createPkcePair } from "./pkce";

/**
 * The verifier values here are checked against Frappe's own implementation
 * (`frappe/oauth.py`), which base64-encodes the SHA-256 digest and then strips
 * `=`, maps `+`→`-` and `/`→`_`. If our encoding disagrees on any of those
 * three substitutions the exchange fails with `invalid_grant` at runtime.
 */
describe("base64UrlEncode", () => {
	it("strips padding and uses the URL-safe alphabet", () => {
		// 0xFB 0xFF produces "+/" in standard base64 — the exact bytes that expose
		// a non-URL-safe encoder.
		const encoded = base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xbf]));

		expect(encoded).not.toContain("+");
		expect(encoded).not.toContain("/");
		expect(encoded).not.toContain("=");
		expect(encoded).toBe("-_-_");
	});

	it("round-trips to the value Frappe would compute", () => {
		expect(base64UrlEncode(new Uint8Array([0, 0, 0]))).toBe("AAAA");
	});
});

describe("createPkcePair", () => {
	const sha256 = async (input: string): Promise<Uint8Array> => {
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
		return new Uint8Array(digest);
	};
	const randomBytes = (length: number): Uint8Array =>
		Uint8Array.from({ length }, (_, index) => index);

	it("always reports S256 — never plain", async () => {
		const pair = await createPkcePair({ randomBytes, sha256 });

		expect(pair.method).toBe("S256");
	});

	it("derives the challenge as base64url(sha256(verifier))", async () => {
		const pair = await createPkcePair({ randomBytes, sha256 });

		expect(pair.challenge).toBe(base64UrlEncode(await sha256(pair.verifier)));
	});

	it("produces a verifier within RFC 7636's 43..128 character bounds", async () => {
		const pair = await createPkcePair({ randomBytes, sha256 });

		expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
		expect(pair.verifier.length).toBeLessThanOrEqual(128);
	});

	it("never reuses a verifier across calls", async () => {
		let seed = 0;
		const varying = (length: number): Uint8Array =>
			Uint8Array.from({ length }, (_, index) => index + seed++);

		const first = await createPkcePair({ randomBytes: varying, sha256 });
		const second = await createPkcePair({ randomBytes: varying, sha256 });

		expect(first.verifier).not.toBe(second.verifier);
	});
});
