import * as React from "react";
import { TextInput } from "react-native";
/**
 * Mirrors the web input. Height is 48 rather than the web's `h-9` for the same
 * touch-target reason as Button. `placeholderTextColor` has to be passed as a
 * prop — React Native has no `placeholder:` pseudo-class — so it is wired to the
 * muted-foreground token via a className on a wrapper is not possible; callers
 * that need a themed placeholder should pass `placeholderClassName`, which
 * NativeWind maps for TextInput.
 */
declare const Input: React.ForwardRefExoticComponent<import("react-native").TextInputProps & React.RefAttributes<TextInput>>;
export { Input };
