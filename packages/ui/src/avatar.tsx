import * as React from "react";
import * as AvatarPrimitive from "@rn-primitives/avatar";

import { cn } from "./lib/cn";

/**
 * Mirrors the web avatar: Avatar / AvatarImage / AvatarFallback.
 *
 * On native the fallback is not merely a nicety — resort Wi-Fi drops, and an
 * avatar that renders nothing while an image request hangs leaves a hole in
 * every staff row. rn-primitives shows the fallback until the image resolves.
 */
const Avatar = React.forwardRef<AvatarPrimitive.RootRef, AvatarPrimitive.RootProps>(
	({ className, ...props }, ref) => (
		<AvatarPrimitive.Root
			ref={ref}
			className={cn("h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted", className)}
			{...props}
		/>
	),
);
Avatar.displayName = "Avatar";

const AvatarImage = React.forwardRef<AvatarPrimitive.ImageRef, AvatarPrimitive.ImageProps>(
	({ className, ...props }, ref) => (
		<AvatarPrimitive.Image ref={ref} className={cn("aspect-square h-full w-full", className)} {...props} />
	),
);
AvatarImage.displayName = "AvatarImage";

const AvatarFallback = React.forwardRef<AvatarPrimitive.FallbackRef, AvatarPrimitive.FallbackProps>(
	({ className, ...props }, ref) => (
		<AvatarPrimitive.Fallback
			ref={ref}
			className={cn("h-full w-full items-center justify-center rounded-full bg-muted", className)}
			{...props}
		/>
	),
);
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
