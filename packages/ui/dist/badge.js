import { jsx as _jsx } from "react/jsx-runtime";
import { View } from "react-native";
import { cva } from "class-variance-authority";
import { cn } from "./lib/cn";
import { TextClassContext } from "./text";
/** Mirrors the web badge: default / secondary / destructive / outline. */
const badgeVariants = cva("flex-row items-center self-start rounded-md border px-2.5 py-0.5", {
    variants: {
        variant: {
            default: "border-transparent bg-primary",
            secondary: "border-transparent bg-secondary",
            destructive: "border-transparent bg-destructive",
            outline: "border-border",
        },
    },
    defaultVariants: { variant: "default" },
});
const badgeTextVariants = cva("text-xs font-semibold", {
    variants: {
        variant: {
            default: "text-primary-foreground",
            secondary: "text-secondary-foreground",
            destructive: "text-destructive-foreground",
            outline: "text-foreground",
        },
    },
    defaultVariants: { variant: "default" },
});
function Badge({ className, variant, ...props }) {
    return (_jsx(TextClassContext.Provider, { value: badgeTextVariants({ variant }), children: _jsx(View, { className: cn(badgeVariants({ variant }), className), ...props }) }));
}
export { Badge, badgeVariants, badgeTextVariants };
