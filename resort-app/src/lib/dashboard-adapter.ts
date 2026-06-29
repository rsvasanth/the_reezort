import type { z } from "zod";

import type { schema } from "@/components/data-table";
import type { SectionCard } from "@/components/section-cards";
import type { DashboardRoom, DashboardSnapshot } from "@/lib/resort-api";

type DashboardRow = z.infer<typeof schema>;

function sumAvailableRooms(snapshot: DashboardSnapshot) {
	return snapshot.availability.reduce(
		(total, item) => total + item.available_rooms,
		0
	);
}

function roomStatus(room: DashboardRoom) {
	if (room.maintenance_status === "Out of Order") {
		return "In Process";
	}

	if (room.occupancy_status === "Occupied") {
		return "Done";
	}

	if (room.housekeeping_status === "Dirty") {
		return "In Process";
	}

	return "Not Started";
}

function roomOwner(room: DashboardRoom) {
	if (room.maintenance_status === "Out of Order") {
		return "Chief engineer";
	}

	if (room.housekeeping_status === "Dirty") {
		return "HK supervisor";
	}

	if (room.occupancy_status === "Occupied") {
		return "Front office";
	}

	return "Duty manager";
}

export function toSectionCards(snapshot: DashboardSnapshot): SectionCard[] {
	const totalRooms = snapshot.kpis.total_rooms;
	const availableRooms = sumAvailableRooms(snapshot);

	return [
		{
			label: "Tonight occupancy",
			value: `${snapshot.kpis.occupancy_percent}%`,
			badge: `${snapshot.kpis.occupied_or_due_rooms}/${totalRooms}`,
			footer: `${snapshot.kpis.occupied_or_due_rooms} occupied or due-in rooms from ${totalRooms} configured rooms.`,
		},
		{
			label: "Sellable rooms",
			value: `${snapshot.kpis.sellable_rooms}`,
			badge: "Live",
			footer: `${snapshot.kpis.sellable_rooms} rooms are sellable after maintenance and restriction checks.`,
		},
		{
			label: "Room types",
			value: `${snapshot.availability.length}`,
			badge: `${availableRooms} ready`,
			footer: "Availability is grouped by ERP-ready room type inventory.",
		},
		{
			label: "Open exceptions",
			value: `${snapshot.kpis.out_of_order_rooms}`,
			badge: `${snapshot.kpis.out_of_order_rooms} OOO`,
			footer: "Out-of-order rooms and blocked inventory needing engineering review.",
		},
	];
}

export function toOperationalRows(snapshot: DashboardSnapshot): DashboardRow[] {
	const rooms = snapshot.rooms.slice(0, 12).map((room, index) => ({
		id: index + 1,
		header: `${room.room_number} ${room.room_type_name ?? "Room"}`,
		type: room.maintenance_status === "Out of Order" ? "Engineering" : "Rooms",
		status: roomStatus(room),
		target: room.display_status,
		limit: room.floor_label ?? room.building_name ?? "Property",
		reviewer: roomOwner(room),
	}));

	if (rooms.length > 0) {
		return rooms;
	}

	return snapshot.availability.map((item, index) => ({
		id: index + 1,
		header: `${item.room_type_name} availability`,
		type: "Reservations",
		status: item.available_rooms > 0 ? "Done" : "In Process",
		target: `${item.available_rooms} rooms`,
		limit: `${item.blocked_rooms} blocked`,
		reviewer: "Revenue manager",
	}));
}
