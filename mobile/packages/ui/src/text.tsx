import * as React from "react";
import { Text as RNText } from "react-native";
import * as Slot from "@rn-primitives/slot";

import { cn } from "./lib/cn";

/**
 * Text colour does not cascade in React Native the way it does in the DOM: a
 * `<View className="text-primary-foreground">` has no effect on a `<Text>`
 * inside it. Container components (Button, Badge) therefore publish the text
 * classes their children should use through this context, and `Text` merges
 * them. This is the standard NativeWind/rn-primitives answer to the problem and
 * is why native needs a `Text` component at all where the web just uses a span.
 */
const TextClassContext = React.createContext<string | undefined>(undefined);

type TextProps = React.ComponentPropsWithoutRef<typeof RNText> & {
	asChild?: boolean;
};

const Text = React.forwardRef<React.ElementRef<typeof RNText>, TextProps>(
	({ className, asChild = false, ...props }, ref) => {
		const textClass = React.useContext(TextClassContext);
		const Component = asChild ? Slot.Text : RNText;
		return (
			<Component
				ref={ref}
				className={cn("text-base text-foreground", textClass, className)}
				{...props}
			/>
		);
	},
);
Text.displayName = "Text";

export { Text, TextClassContext, type TextProps };
