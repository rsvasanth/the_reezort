import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { TextInput } from "react-native";
import { cn } from "./lib/cn";
/**
 * Mirrors the web input. Height is 48 rather than the web's `h-9` for the same
 * touch-target reason as Button. `placeholderTextColor` has to be passed as a
 * prop — React Native has no `placeholder:` pseudo-class — so it is wired to the
 * muted-foreground token via a className on a wrapper is not possible; callers
 * that need a themed placeholder should pass `placeholderClassName`, which
 * NativeWind maps for TextInput.
 */
const Input = React.forwardRef(({ className, placeholderClassName, ...props }, ref) => (_jsx(TextInput, { ref: ref, className: cn("h-12 w-full rounded-md border border-input bg-background px-3 py-1 text-base text-foreground", props.editable === false && "opacity-50", className), placeholderClassName: cn("text-muted-foreground", placeholderClassName), ...props })));
Input.displayName = "Input";
export { Input };
