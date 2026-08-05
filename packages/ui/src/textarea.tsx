import * as React from "react";
import { TextInput } from "react-native";

import { cn } from "./lib/cn";

/**
 * Mirrors the web textarea. Same component as Input underneath — React Native
 * has one TextInput and `multiline` is a prop, not a different element — but it
 * is exported separately so screens read the same on both platforms.
 *
 * `textAlignVertical="top"` is required on Android: without it multiline text
 * centres itself vertically in the box, which looks like a rendering bug.
 */
const Textarea = React.forwardRef<
	React.ElementRef<typeof TextInput>,
	React.ComponentPropsWithoutRef<typeof TextInput>
>(({ className, placeholderClassName, ...props }, ref) => (
	<TextInput
		ref={ref}
		multiline
		textAlignVertical="top"
		className={cn(
			"min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground",
			props.editable === false && "opacity-50",
			className,
		)}
		placeholderClassName={cn("text-muted-foreground", placeholderClassName)}
		{...props}
	/>
));
Textarea.displayName = "Textarea";

export { Textarea };
