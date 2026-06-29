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
