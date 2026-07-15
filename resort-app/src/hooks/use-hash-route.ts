import { useEffect, useState } from "react";

/**
 * Read window.location.hash and subscribe to hashchange events.
 *
 * Hash routes (no router library):
 *   #/cockpit             → executive cockpit (dashboard), reachable regardless of role
 *   #/folio/<name>        → folio workspace
 *   #/housekeeping        → housekeeping board
 *   #/setup               → property setup wizard
 *   #/condition/<stay>    → room condition capture for a stay
 *   #/restaurant          → restaurant POS floor plan
 *   #/restaurant/table/<order> → order detail / cart
 *   #/restaurant/kitchen  → KOT kitchen queue
 *   #/restaurant/management → F&B management hub (sales / calendar / dishes / shifts / audit)
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
	| { kind: "cockpit" }
	| { kind: "folio"; name: string | null }
	| { kind: "housekeeping" }
	| { kind: "setup" }
	| { kind: "staff" }
	| { kind: "attendance" }
	| { kind: "servicedesk" }
	| { kind: "billing" }
	| { kind: "frontdesk" }
	| { kind: "reservations"; id: string | null }
	| { kind: "reservation-forecast" }
	| { kind: "checkin"; reservation: string | null }
	| { kind: "mytasks" }
	| { kind: "tasks" }
	| { kind: "myday" }
	| { kind: "room"; code: string | null }
	| { kind: "property"; code: string | null }
	| { kind: "building"; code: string | null }
	| { kind: "floor"; code: string | null }
	| { kind: "approvals" }
	| { kind: "audit" }
	| { kind: "restaurant" }
	| { kind: "restaurant-table"; order: string | null }
	| { kind: "restaurant-kitchen" }
	| { kind: "restaurant-management" }
	| { kind: "maintenance" }
	| { kind: "engineering-board" }
	| { kind: "cashier-close" }
	| { kind: "analytics-revenue" }
	| { kind: "ota-inbox" }
	| { kind: "guest-relations" }
	| { kind: "crm" }
	| { kind: "guest"; id: string | null }
	| { kind: "condition"; stay: string | null }
	| { kind: "direct-bill" }
	| { kind: "book" };

export function parseHashRoute(hash: string): ParsedRoute {
	const path = hash.startsWith("#") ? hash.slice(1) : hash;
	if (!path || path === "/") return { kind: "dashboard" };

	if (path === "/cockpit") return { kind: "cockpit" };

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
	if (path === "/direct-bill") return { kind: "direct-bill" };
	if (path === "/book" || path.startsWith("/book?")) return { kind: "book" };

	if (path === "/frontdesk") return { kind: "frontdesk" };

	if (path === "/reservations/forecast") return { kind: "reservation-forecast" };
	const reservationsMatch = path.match(/^\/reservations(?:\/(.*))?$/);
	if (reservationsMatch) {
		const id = reservationsMatch[1];
		return { kind: "reservations", id: id ? decodeURIComponent(id) : null };
	}

	if (path === "/my-tasks") return { kind: "mytasks" };
	if (path === "/tasks") return { kind: "tasks" };
	if (path === "/my-day") return { kind: "myday" };
	if (path === "/approvals") return { kind: "approvals" };
	if (path === "/audit") return { kind: "audit" };

	const roomMatch = path.match(/^\/room(?:\/(.*))?$/);
	if (roomMatch) return { kind: "room", code: roomMatch[1] ? decodeURIComponent(roomMatch[1]) : null };
	const propMatch = path.match(/^\/property(?:\/(.*))?$/);
	if (propMatch) return { kind: "property", code: propMatch[1] ? decodeURIComponent(propMatch[1]) : null };
	const bldMatch = path.match(/^\/building(?:\/(.*))?$/);
	if (bldMatch) return { kind: "building", code: bldMatch[1] ? decodeURIComponent(bldMatch[1]) : null };
	const floorMatch = path.match(/^\/floor(?:\/(.*))?$/);
	if (floorMatch) return { kind: "floor", code: floorMatch[1] ? decodeURIComponent(floorMatch[1]) : null };

	// Restaurant POS — order matters: kitchen + management + table before the bare outlet route.
	if (path === "/restaurant/kitchen") return { kind: "restaurant-kitchen" };
	if (path === "/restaurant/management") return { kind: "restaurant-management" };
	const tableMatch = path.match(/^\/restaurant\/table(?:\/(.*))?$/);
	if (tableMatch) {
		const order = tableMatch[1];
		return { kind: "restaurant-table", order: order ? decodeURIComponent(order) : null };
	}
	if (path === "/restaurant") return { kind: "restaurant" };

	// Engineering board — must match before bare /maintenance.
	if (path === "/maintenance/engineering") return { kind: "engineering-board" };

	// Maintenance inbox — tolerate a trailing ?ticket=… deep-link query.
	if (path === "/maintenance" || path.startsWith("/maintenance?")) return { kind: "maintenance" };

	if (path === "/cashier-close" || path.startsWith("/cashier-close?")) return { kind: "cashier-close" };

	if (path === "/analytics/revenue" || path.startsWith("/analytics/revenue?")) return { kind: "analytics-revenue" };

	if (path === "/integrations/ota-inbox" || path.startsWith("/integrations/ota-inbox?")) return { kind: "ota-inbox" };

	if (path === "/guest-relations") return { kind: "guest-relations" };

	if (path === "/crm") return { kind: "crm" };

	const guestMatch = path.match(/^\/guest(?:\/(.*))?$/);
	if (guestMatch) {
		const id = guestMatch[1];
		return { kind: "guest", id: id ? decodeURIComponent(id) : null };
	}

	const checkinMatch = path.match(/^\/check-in(?:\/(.*))?$/);
	if (checkinMatch) {
		const reservation = checkinMatch[1];
		return { kind: "checkin", reservation: reservation ? decodeURIComponent(reservation) : null };
	}

	const conditionMatch = path.match(/^\/condition(?:\/(.*))?$/);
	if (conditionMatch) {
		const stay = conditionMatch[1];
		return { kind: "condition", stay: stay ? decodeURIComponent(stay) : null };
	}

	return { kind: "dashboard" };
}
