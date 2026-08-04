import * as React from "react";
import { Text as RNText } from "react-native";
/**
 * Text colour does not cascade in React Native the way it does in the DOM: a
 * `<View className="text-primary-foreground">` has no effect on a `<Text>`
 * inside it. Container components (Button, Badge) therefore publish the text
 * classes their children should use through this context, and `Text` merges
 * them. This is the standard NativeWind/rn-primitives answer to the problem and
 * is why native needs a `Text` component at all where the web just uses a span.
 */
declare const TextClassContext: React.Context<string | undefined>;
type TextProps = React.ComponentPropsWithoutRef<typeof RNText> & {
    asChild?: boolean;
};
declare const Text: React.ForwardRefExoticComponent<import("react-native").TextProps & {
    asChild?: boolean;
} & React.RefAttributes<RNText>>;
export { Text, TextClassContext, type TextProps };
