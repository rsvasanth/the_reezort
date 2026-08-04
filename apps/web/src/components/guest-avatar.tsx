import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type AvatarSize = "sm" | "md" | "lg";

export type GuestAvatarProps = {
	/** Guest display name — used for initials fallback. Safe to omit. */
	name?: string | null;
	/** Photo URL. When absent or the image fails to load, initials are shown. */
	imageUrl?: string | null;
	/** sm = 8 (2rem), md = 10 (2.5rem, default), lg = 14 (3.5rem) */
	size?: AvatarSize;
	className?: string;
};

const SIZE_CLASS: Record<AvatarSize, string> = {
	sm: "h-8 w-8 text-xs",
	md: "h-10 w-10 text-sm",
	lg: "h-14 w-14 text-base",
};

/**
 * Reusable guest avatar.
 *
 * Shows the photo when imageUrl is present and the browser can load it;
 * falls back to up-to-two-character initials derived from name; falls back
 * to "?" when name is also absent.
 *
 * Matches the grayscale-friendly muted palette used by the existing shadcn
 * Avatar primitive — no colour assumptions made on the fallback chip.
 */
export function GuestAvatar({ name, imageUrl, size = "md", className }: GuestAvatarProps) {
	const initials = deriveInitials(name);

	return (
		<Avatar className={cn(SIZE_CLASS[size], className)}>
			{imageUrl && (
				<AvatarImage
					src={imageUrl}
					alt={name ?? "Guest photo"}
					// AvatarImage hides itself on load error; AvatarFallback takes over.
				/>
			)}
			<AvatarFallback className="select-none font-medium tracking-wide">
				{initials}
			</AvatarFallback>
		</Avatar>
	);
}

/** Derives up to two uppercase initials from a display name. */
function deriveInitials(name: string | null | undefined): string {
	if (!name || typeof name !== "string") return "?";
	const trimmed = name.trim();
	if (!trimmed) return "?";

	const parts = trimmed.split(/\s+/).filter(Boolean);
	if (parts.length === 1) {
		return parts[0].charAt(0).toUpperCase();
	}
	return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
