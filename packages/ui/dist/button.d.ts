import * as React from "react";
import { Pressable } from "react-native";
import { type VariantProps } from "class-variance-authority";
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
declare const buttonVariants: (props?: ({
    variant?: "link" | "default" | "secondary" | "destructive" | "outline" | "ghost" | null | undefined;
    size?: "default" | "sm" | "lg" | "icon" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const buttonTextVariants: (props?: ({
    variant?: "link" | "default" | "secondary" | "destructive" | "outline" | "ghost" | null | undefined;
    size?: "default" | "sm" | "lg" | "icon" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
type ButtonProps = React.ComponentPropsWithoutRef<typeof Pressable> & VariantProps<typeof buttonVariants>;
declare const Button: React.ForwardRefExoticComponent<Omit<import("react-native").PressableProps & React.RefAttributes<import("react-native").View>, "ref"> & VariantProps<(props?: ({
    variant?: "link" | "default" | "secondary" | "destructive" | "outline" | "ghost" | null | undefined;
    size?: "default" | "sm" | "lg" | "icon" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<import("react-native").View>>;
export { Button, buttonVariants, buttonTextVariants, type ButtonProps };
