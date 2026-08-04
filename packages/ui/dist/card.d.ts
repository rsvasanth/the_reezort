import * as React from "react";
import { View } from "react-native";
/**
 * Same six exports as the web card, same padding rhythm (p-6 / pt-0). `space-y-*`
 * is replaced with `gap-*`: React Native's flexbox has `gap`, and NativeWind's
 * space-y relies on a DOM sibling selector that has no native equivalent.
 */
declare const Card: React.ForwardRefExoticComponent<import("react-native").ViewProps & React.RefAttributes<View>>;
declare const CardHeader: React.ForwardRefExoticComponent<import("react-native").ViewProps & React.RefAttributes<View>>;
declare const CardTitle: React.ForwardRefExoticComponent<Omit<import("react-native").TextProps & {
    asChild?: boolean;
} & React.RefAttributes<import("react-native").Text>, "ref"> & React.RefAttributes<import("react-native").Text>>;
declare const CardDescription: React.ForwardRefExoticComponent<Omit<import("react-native").TextProps & {
    asChild?: boolean;
} & React.RefAttributes<import("react-native").Text>, "ref"> & React.RefAttributes<import("react-native").Text>>;
declare const CardContent: React.ForwardRefExoticComponent<import("react-native").ViewProps & React.RefAttributes<View>>;
declare const CardFooter: React.ForwardRefExoticComponent<import("react-native").ViewProps & React.RefAttributes<View>>;
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
