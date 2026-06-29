/**
 * RoomGrid — groups rooms by building → floor and renders them in a grid.
 *
 * Groups are sorted building-alphabetically, then floors numerically.
 * Rooms within a floor are sorted by room_number.
 */

import { Building2 } from "lucide-react";

import { Separator } from "@/components/ui/separator";

import type { HousekeepingRoom } from "@/lib/housekeeping-api";
import { RoomCard } from "./room-card";

type Props = {
	rooms: HousekeepingRoom[];
	isMock: boolean;
	onMutated: () => void;
};

type FloorGroup = {
	floor: string;
	rooms: HousekeepingRoom[];
};

type BuildingGroup = {
	building: string;
	floors: FloorGroup[];
};

function groupRooms(rooms: HousekeepingRoom[]): BuildingGroup[] {
	// building → floor → rooms
	const byBuilding = new Map<string, Map<string, HousekeepingRoom[]>>();

	for (const room of rooms) {
		const building = room.building || "Unassigned";
		const floor = room.floor || "G";
		const buildingMap = byBuilding.get(building) ?? new Map<string, HousekeepingRoom[]>();
		const floorList = buildingMap.get(floor) ?? [];
		floorList.push(room);
		buildingMap.set(floor, floorList);
		byBuilding.set(building, buildingMap);
	}

	// Sort rooms within each floor by room_number (numeric-aware)
	const sortRoomNumber = (a: HousekeepingRoom, b: HousekeepingRoom) => {
		const na = parseInt(a.room_number, 10);
		const nb = parseInt(b.room_number, 10);
		if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
		return a.room_number.localeCompare(b.room_number);
	};

	// Sort floors numerically / alpha
	const sortFloor = (a: string, b: string) => {
		const na = parseInt(a, 10);
		const nb = parseInt(b, 10);
		if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
		return a.localeCompare(b);
	};

	return Array.from(byBuilding.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([building, floorMap]) => ({
			building,
			floors: Array.from(floorMap.entries())
				.sort(([a], [b]) => sortFloor(a, b))
				.map(([floor, floorRooms]) => ({
					floor,
					rooms: [...floorRooms].sort(sortRoomNumber),
				})),
		}));
}

function floorLabel(floor: string): string {
	const n = parseInt(floor, 10);
	if (Number.isNaN(n)) return `Floor ${floor}`;
	if (n === 0) return "Ground Floor";
	const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
	return `${n}${suffix} Floor`;
}

export function RoomGrid({ rooms, isMock, onMutated }: Props) {
	const groups = groupRooms(rooms);

	return (
		<div className="flex flex-col gap-8">
			{groups.map((building, bi) => (
				<section key={building.building}>
					{/* Building header */}
					<div className="mb-4 flex items-center gap-2">
						<Building2 className="size-4 text-muted-foreground" />
						<h2 className="text-base font-semibold">{building.building}</h2>
					</div>

					<div className="flex flex-col gap-6">
						{building.floors.map((floor, fi) => (
							<div key={floor.floor}>
								{/* Floor sub-header */}
								<div className="mb-2 flex items-center gap-3">
									<span className="text-sm font-medium text-muted-foreground">
										{floorLabel(floor.floor)}
									</span>
									<Separator className="flex-1" />
									<span className="text-xs text-muted-foreground">
										{floor.rooms.length} room{floor.rooms.length !== 1 ? "s" : ""}
									</span>
								</div>

								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
									{floor.rooms.map((room) => (
										<RoomCard
											key={room.name}
											room={room}
											isMock={isMock}
											onMutated={onMutated}
										/>
									))}
								</div>

								{/* Separator between floors within a building, except last */}
								{fi < building.floors.length - 1 && (
									<Separator className="mt-6" />
								)}
							</div>
						))}
					</div>

					{/* Separator between buildings, except last */}
					{bi < groups.length - 1 && <Separator className="mt-8" />}
				</section>
			))}
		</div>
	);
}
