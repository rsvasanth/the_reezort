import * as React from "react";
import { View } from "react-native";
import { type VariantProps } from "class-variance-authority";
/** Mirrors the web badge: default / secondary / destructive / outline. */
declare const badgeVariants: (props?: ({
    variant?: "default" | "secondary" | "destructive" | "outline" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const badgeTextVariants: (props?: ({
    variant?: "default" | "secondary" | "destructive" | "outline" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
type BadgeProps = React.ComponentPropsWithoutRef<typeof View> & VariantProps<typeof badgeVariants>;
declare function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element;
export { Badge, badgeVariants, badgeTextVariants, type BadgeProps };
