/**
 * Housekeeping formatting helpers — pure functions, no React deps.
 */

import type {
	HousekeepingStatus,
	OccupancyStatus,
	MaintenanceStatus,
	TaskStatus,
	TaskPriority,
} from "@/lib/housekeeping-api";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export type StatusBadgeStyle = {
	variant: BadgeVariant;
	className?: string;
};

export function housekeepingStatusBadge(status: HousekeepingStatus): StatusBadgeStyle {
	switch (status) {
		case "Clean":
			return { variant: "default", className: "bg-emerald-600 hover:bg-emerald-600/90" };
		case "Inspected":
			return { variant: "default", className: "bg-teal-600 hover:bg-teal-600/90" };
		case "In Progress":
			return { variant: "default", className: "bg-blue-600 hover:bg-blue-600/90" };
		case "Dirty":
			return { variant: "default", className: "bg-rose-600 hover:bg-rose-600/90" };
		case "Pickup":
			return { variant: "default", className: "bg-violet-600 hover:bg-violet-600/90" };
		case "Turndown Required":
			return { variant: "secondary" };
		case "Out of Service Cleaning":
			return { variant: "destructive" };
		default:
			return { variant: "outline" };
	}
}

export function housekeepingStatusTooltip(status: HousekeepingStatus): string {
	switch (status) {
		case "Clean":
			return "Room is clean and ready for the next guest.";
		case "Inspected":
			return "Room has passed inspection.";
		case "In Progress":
			return "Housekeeping attendant is currently cleaning.";
		case "Dirty":
			return "Room requires cleaning.";
		case "Pickup":
			return "Quick pickup required — guest is due in soon.";
		case "Turndown Required":
			return "Evening turndown service pending.";
		case "Out of Service Cleaning":
			return "Room is out of service for deep or corrective cleaning.";
		default:
			return status;
	}
}

export function occupancyStatusBadge(status: OccupancyStatus): StatusBadgeStyle {
	switch (status) {
		case "Occupied":
		case "Stayover":
			return { variant: "default" };
		case "Due In":
			return { variant: "secondary", className: "text-amber-700 dark:text-amber-300" };
		case "Due Out":
			return { variant: "secondary", className: "text-rose-700 dark:text-rose-300" };
		case "Day Use":
			return { variant: "secondary" };
		case "Vacant":
		default:
			return { variant: "outline" };
	}
}

export function occupancyStatusTooltip(status: OccupancyStatus): string {
	switch (status) {
		case "Occupied":
			return "Room is currently occupied by a guest.";
		case "Stayover":
			return "Guest is staying over — do not disturb unless requested.";
		case "Due In":
			return "Guest is expected to check in today.";
		case "Due Out":
			return "Guest is expected to check out today.";
		case "Day Use":
			return "Day-use reservation in progress.";
		case "Vacant":
			return "Room is vacant.";
		default:
			return status;
	}
}

export function maintenanceStatusBadge(status: MaintenanceStatus): StatusBadgeStyle {
	switch (status) {
		case "Out of Order":
			return { variant: "destructive" };
		case "Out of Service":
		case "Under Maintenance":
			return { variant: "destructive", className: "bg-orange-600 hover:bg-orange-600/90" };
		case "None":
		default:
			return { variant: "outline" };
	}
}

export function taskStatusBadge(status: TaskStatus): StatusBadgeStyle {
	switch (status) {
		case "Completed":
			return { variant: "default", className: "bg-emerald-600 hover:bg-emerald-600/90" };
		case "In Progress":
			return { variant: "default", className: "bg-blue-600 hover:bg-blue-600/90" };
		case "Assigned":
			return { variant: "secondary" };
		case "Paused":
			return { variant: "outline", className: "border-amber-500 text-amber-700 dark:text-amber-300" };
		case "Cancelled":
			return { variant: "destructive" };
		case "Open":
		default:
			return { variant: "outline" };
	}
}

export function priorityBadge(priority: TaskPriority): StatusBadgeStyle {
	switch (priority) {
		case "Urgent":
			return { variant: "destructive" };
		case "High":
			return { variant: "default", className: "bg-orange-600 hover:bg-orange-600/90" };
		case "Normal":
			return { variant: "secondary" };
		case "Low":
		default:
			return { variant: "outline" };
	}
}

/**
 * Returns initials from a display name, e.g. "Priya Sharma" → "PS"
 */
export function getInitials(name: string | null): string {
	if (!name) return "?";
	return name
		.trim()
		.split(/\s+/)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.slice(0, 2)
		.join("");
}

/**
 * Format ISO datetime string as "HH:MM" in local time.
 */
export function formatDueAt(iso: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
