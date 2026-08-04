import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { Switch as RNSwitch } from "react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@reezort/tokens";
const Switch = React.forwardRef(({ ...props }, ref) => {
    const { colorScheme } = useColorScheme();
    const palette = COLORS[colorScheme === "dark" ? "dark" : "light"];
    return (_jsx(RNSwitch, { ref: ref, trackColor: { false: palette.muted, true: palette.primary }, thumbColor: palette.card, ios_backgroundColor: palette.muted, ...props }));
});
Switch.displayName = "Switch";
export { Switch };
