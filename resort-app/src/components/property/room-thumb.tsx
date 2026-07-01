/**
 * RoomThumb — reusable square thumbnail for any Room reference.
 *
 * Falls back to an initials-style stone tile when no image is present, so
 * every list stays visually consistent. Rooms with an image render the
 * image; rooms without still show the room number so nothing looks broken.
 */

import { cn } from "@/lib/utils";

export function RoomThumb({
	image,
	label,
	size = 40,
	className,
}: {
	image?: string | null;
	label: string;
	size?: number;
	className?: string;
}) {
	const initials = label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
	const style = { width: size, height: size };
	if (image) {
		return (
			<img
				src={image}
				alt={label}
				style={style}
				className={cn(
					"shrink-0 rounded-md object-cover ring-1 ring-border",
					className,
				)}
			/>
		);
	}
	return (
		<div
			style={style}
			className={cn(
				"flex shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-stone-200 to-stone-100 text-xs font-medium text-stone-600 ring-1 ring-border dark:from-stone-800 dark:to-stone-900 dark:text-stone-300",
				className,
			)}
			aria-label={label}
		>
			{initials}
		</div>
	);
}
