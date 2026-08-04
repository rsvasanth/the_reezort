import * as React from "react";
import { Switch as RNSwitch } from "react-native";
/**
 * React Native's own Switch, themed from the token palette.
 *
 * This one is deliberately NOT built on a primitive. Android's switch has
 * platform-standard motion and haptics that users recognise, and `trackColor` /
 * `thumbColor` take colour strings rather than classNames — so this is one of
 * the few places that reaches into `@reezort/tokens` for values instead of using
 * NativeWind classes. Same reason navigation chrome does.
 *
 * The prop shape (`value` / `onValueChange`) is React Native's, not the web's
 * (`checked` / `onCheckedChange`). Renaming it to match the web would mean
 * lying about what the underlying component accepts.
 */
type SwitchProps = React.ComponentPropsWithoutRef<typeof RNSwitch>;
declare const Switch: React.ForwardRefExoticComponent<import("react-native").SwitchProps & React.RefAttributes<RNSwitch>>;
export { Switch, type SwitchProps };
