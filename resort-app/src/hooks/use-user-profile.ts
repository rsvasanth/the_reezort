import { useEffect, useState } from "react";

export type UserProfile = {
	user: string;
	fullName: string;
	primaryRole: string;
	roles: string[];
	isSystemManager: boolean;
};

// Roles that retain ERPNext desk access after the SPA-first lockdown (D1/D2).
const DESK_ROLES = ["Resort Manager", "Accounts User", "Accounts Manager"];

/** Whether this user should see/reach the ERPNext desk. Operational roles are SPA-only. */
export function canAccessDesk(profile: UserProfile | null): boolean {
	if (!profile) return false;
	return profile.isSystemManager || profile.roles.some((r) => DESK_ROLES.includes(r));
}

const MANAGER_ROLES = ["System Manager", "Resort Manager"];

export function isManager(profile: UserProfile | null): boolean {
	if (!profile) return false;
	if (profile.isSystemManager) return true;
	return profile.roles.some((r) => MANAGER_ROLES.includes(r));
}

/**
 * The screen a user lands on when they open the app with no hash route.
 * Managers see the cockpit; operational roles go straight to their workspace.
 */
export function defaultLandingRoute(profile: UserProfile | null): string {
	if (!profile) return "";
	if (isManager(profile)) return "";
	// Non-manager staff land on the personal "My Day" surface first — the
	// clock, shift, open tasks, quick request links, latest payslip.
	return "#/my-day";
}

/**
 * Which sidebar items each non-manager role gets — managers see everything.
 * Including extras beyond the must-haves keeps the shell discoverable.
 */
const ROLE_SIDEBAR: Record<string, string[]> = {
	"Front Desk": ["Executive cockpit", "Reservations", "Front desk", "Housekeeping", "All tasks", "Billing", "Service desk", "Maintenance"],
	"Reservation Agent": ["Executive cockpit", "Reservations", "Front desk", "Billing"],
	Housekeeping: ["Executive cockpit", "Housekeeping", "My tasks", "Service desk"],
	Maintenance: ["Executive cockpit", "My tasks", "Service desk", "Housekeeping", "Maintenance"],
	"Accounts User": ["Executive cockpit", "Billing", "Reservations", "Front desk"],
	"Accounts Manager": ["Executive cockpit", "Billing", "Reservations", "Front desk"],
	Restaurant: ["Executive cockpit", "Restaurant & bar"],
	Concierge: ["Executive cockpit", "Concierge", "Front desk", "Reservations"],
};

/** Returns the set of sidebar titles a user may see — null = everything (managers). */
export function allowedSidebarTitles(profile: UserProfile | null): Set<string> | null {
	if (!profile || isManager(profile)) return null;
	const allowed = new Set<string>();
	for (const role of profile.roles) {
		const items = ROLE_SIDEBAR[role];
		if (items) items.forEach((i) => allowed.add(i));
	}
	if (allowed.size === 0) allowed.add("Executive cockpit");
	return allowed;
}

/**
 * Loads the logged-in user's profile (name + roles) from
 * the_reezort.account.api.get_current_user_profile. Falls back to the bare
 * user id while loading or if the endpoint is unavailable, so the sidebar
 * always renders something sensible.
 */
export function useUserProfile(fallbackUser?: string | null): UserProfile | null {
	const [profile, setProfile] = useState<UserProfile | null>(null);

	useEffect(() => {
		let active = true;

		fetch("/api/method/the_reezort.account.api.get_current_user_profile", {
			credentials: "include",
			headers: { Accept: "application/json" },
		})
			.then((response) => response.json())
			.then((payload) => {
				if (!active) return;
				const data = payload?.message?.data;
				if (data?.user) {
					setProfile({
						user: data.user,
						fullName: data.full_name || data.user,
						primaryRole: data.primary_role || "Staff",
						roles: Array.isArray(data.roles) ? data.roles : [],
						isSystemManager: Boolean(data.is_system_manager),
					});
				}
			})
			.catch(() => {});

		return () => {
			active = false;
		};
	}, []);

	if (!profile && fallbackUser) {
		return {
			user: fallbackUser,
			fullName: fallbackUser,
			primaryRole: "Staff",
			roles: [],
			isSystemManager: false,
		};
	}

	return profile;
}
