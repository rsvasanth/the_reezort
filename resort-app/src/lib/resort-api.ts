export type DashboardRoom = {
	name: string;
	room_number: string;
	display_status: string;
	occupancy_status: string;
	housekeeping_status: string;
	maintenance_status: string;
	sellable_status: string;
	room_type_name?: string;
	building_name?: string;
	floor_label?: string;
};

export type DashboardAvailability = {
	room_type: string;
	room_type_name: string;
	physical_rooms: number;
	blocked_rooms: number;
	available_rooms: number;
};

export type DashboardSnapshot = {
	property?: string;
	property_name?: string;
	kpis: {
		total_rooms: number;
		sellable_rooms: number;
		occupied_or_due_rooms: number;
		occupancy_percent: number;
		out_of_order_rooms: number;
	};
	status_counts: Record<string, number>;
	availability: DashboardAvailability[];
	rooms: DashboardRoom[];
};

type FrappeResponse<T> = {
	message?: T;
	exc?: string;
	_exception?: string;
};

export async function getManagementDashboardSnapshot(property = "RZ-DEMO") {
	const params = new URLSearchParams({ property });
	const response = await fetch(
		`/api/method/the_reezort.property.api.get_management_dashboard_snapshot?${params}`,
		{
			credentials: "include",
			headers: {
				Accept: "application/json",
			},
		}
	);

	if (!response.ok) {
		throw new Error(`Dashboard snapshot failed with ${response.status}`);
	}

	const payload = (await response.json()) as FrappeResponse<DashboardSnapshot>;

	if (payload.exc || payload._exception || !payload.message) {
		throw new Error("Dashboard snapshot returned an invalid response");
	}

	return payload.message;
}
