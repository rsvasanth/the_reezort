import * as React from "react";
/**
 * `@rn-primitives/checkbox` is the direct port of `@radix-ui/react-checkbox`, so
 * the composition shape matches the web wrapper.
 *
 * One API difference the caller must know about: `rn-primitives` models
 * `checked` as a plain boolean, where the web wrapper accepts
 * `boolean | "indeterminate"`. Nothing in the ops app uses the indeterminate
 * state today (it exists on web for table select-all headers, which have no
 * mobile counterpart), so this is not papered over with a fake tri-state —
 * if a screen ever needs it, it needs a real implementation, not a cast.
 */
declare const Checkbox: React.ForwardRefExoticComponent<Omit<import("react-native").PressableProps & React.RefAttributes<import("react-native").View>, "ref"> & {
    asChild?: boolean;
} & {
    onKeyDown?: (ev: React.KeyboardEvent) => void;
    onKeyUp?: (ev: React.KeyboardEvent) => void;
} & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
} & React.RefAttributes<import("react-native").View>>;
export { Checkbox };
