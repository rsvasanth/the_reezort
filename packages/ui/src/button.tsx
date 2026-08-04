import * as React from "react";
import { Pressable } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/cn";
import { TextClassContext } from "./text";

/**
 * Mirrors `resort-app/src/components/ui/button.tsx`: same variant names
 * (default / destructive / outline / secondary / ghost / link), same size names
 * (default / sm / lg / icon), same `asChild`-free call shape. Two deliberate
 * differences, both forced by the platform rather than by taste:
 *
 * 1. **Heights differ.** Web is `h-9` (36px). Android's accessibility guidance
 *    puts the minimum touch target at 48px, which the previous token module
 *    already encoded as MIN_TOUCH_TARGET. Rule 5 asks for a mirrored *API*, not
 *    identical pixels — "share the styling vocabulary, not the components".
 * 2. **`hover:` becomes `active:`.** There is no hover on a touch device.
 *
 * Text colour is published through TextClassContext because it cannot cascade
 * to a child `<Text>` in React Native — see the note in text.tsx.
 */
const buttonVariants = cva(
	"flex-row items-center justify-center gap-2 rounded-md disabled:opacity-50",
	{
		variants: {
			variant: {
				default: "bg-primary active:bg-primary/90",
				destructive: "bg-destructive active:bg-destructive/90",
				outline: "border border-input bg-background active:bg-accent",
				secondary: "bg-secondary active:bg-secondary/80",
				ghost: "active:bg-accent",
				link: "",
			},
			size: {
				default: "h-12 px-4 py-2",
				sm: "h-10 rounded-md px-3",
				lg: "h-14 rounded-md px-8",
				icon: "h-12 w-12",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

const buttonTextVariants = cva("font-medium", {
	variants: {
		variant: {
			default: "text-primary-foreground",
			destructive: "text-destructive-foreground",
			outline: "text-foreground",
			secondary: "text-secondary-foreground",
			ghost: "text-foreground",
			link: "text-primary underline",
		},
		size: {
			default: "text-sm",
			sm: "text-xs",
			lg: "text-base",
			icon: "text-sm",
		},
	},
	defaultVariants: { variant: "default", size: "default" },
});

type ButtonProps = React.ComponentPropsWithoutRef<typeof Pressable> &
	VariantProps<typeof buttonVariants>;

const Button = React.forwardRef<React.ElementRef<typeof Pressable>, ButtonProps>(
	({ className, variant, size, ...props }, ref) => (
		<TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
			<Pressable
				ref={ref}
				role="button"
				className={cn(buttonVariants({ variant, size }), className)}
				{...props}
			/>
		</TextClassContext.Provider>
	),
);
Button.displayName = "Button";

export { Button, buttonVariants, buttonTextVariants, type ButtonProps };
