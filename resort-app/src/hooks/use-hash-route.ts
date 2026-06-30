import { useEffect, useState } from "react";

/**
 * Read window.location.hash and subscribe to hashchange events.
 *
 * Hash routes (no router library):
 *   #/folio/<name>        → folio workspace
 *   #/housekeeping        → housekeeping board
 *   #/setup               → property setup wizard
 *   #/condition/<stay>    → room condition capture for a stay
 *   (anything else)       → dashboard
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
	| { kind: "folio"; name: string | null }
	| { kind: "housekeeping" }
	| { kind: "setup" }
	| { kind: "staff" }
	| { kind: "attendance" }
	| { kind: "servicedesk" }
	| { kind: "billing" }
	| { kind: "frontdesk" }
	| { kind: "reservations" }
	| { kind: "condition"; stay: string | null };

export function parseHashRoute(hash: string): ParsedRoute {
	const path = hash.startsWith("#") ? hash.slice(1) : hash;
	if (!path || path === "/") return { kind: "dashboard" };

	const folioMatch = path.match(/^\/folio(?:\/(.*))?$/);
	if (folioMatch) {
		const name = folioMatch[1];
		return { kind: "folio", name: name ? decodeURIComponent(name) : null };
	}

	if (path === "/housekeeping") return { kind: "housekeeping" };

	if (path === "/setup") return { kind: "setup" };

	if (path === "/staff") return { kind: "staff" };

	if (path === "/attendance") return { kind: "attendance" };

	if (path === "/servicedesk") return { kind: "servicedesk" };

	if (path === "/billing") return { kind: "billing" };

	if (path === "/frontdesk") return { kind: "frontdesk" };

	if (path === "/reservations") return { kind: "reservations" };

	const conditionMatch = path.match(/^\/condition(?:\/(.*))?$/);
	if (conditionMatch) {
		const stay = conditionMatch[1];
		return { kind: "condition", stay: stay ? decodeURIComponent(stay) : null };
	}

	return { kind: "dashboard" };
}
