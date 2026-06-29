import { useEffect, useState } from "react";

/**
 * Read window.location.hash and subscribe to hashchange events.
 *
 * The folio workspace is mounted on hash routes:
 *   #/folio/<name>   → folio workspace
 *   (anything else)  → dashboard
 *
 * Keeping routing as a tiny hook avoids pulling in a router library;
 * the App-level switch consumes the parsed route.
 */
export function useHashRoute(): string {
	const [hash, setHash] = useState<string>(() =>
		typeof window === "undefined" ? "" : window.location.hash
	);

	useEffect(() => {
		function onChange() {
			setHash(window.location.hash);
		}
		window.addEventListener("hashchange", onChange);
		return () => window.removeEventListener("hashchange", onChange);
	}, []);

	return hash;
}

export type ParsedRoute =
	| { kind: "dashboard" }
	| { kind: "folio"; name: string }
	| { kind: "folio"; name: null };

export function parseHashRoute(hash: string): ParsedRoute {
	// strip leading '#'
	const path = hash.startsWith("#") ? hash.slice(1) : hash;
	if (!path || path === "/" || path === "") return { kind: "dashboard" };
	const folioMatch = path.match(/^\/folio(?:\/(.*))?$/);
	if (folioMatch) {
		const name = folioMatch[1];
		return { kind: "folio", name: name ? decodeURIComponent(name) : null };
	}
	return { kind: "dashboard" };
}
