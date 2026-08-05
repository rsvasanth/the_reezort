import * as React from "react";
import { Animated, View, type ViewProps } from "react-native";

import { cn } from "./lib/cn";

/**
 * Mirrors the web skeleton. The web uses `animate-pulse`, a CSS keyframe with no
 * NativeWind equivalent, so the pulse is driven by Animated here.
 *
 * `useNativeDriver` is on: opacity is one of the few properties the native
 * driver supports, which keeps the animation on the UI thread and stops it
 * stuttering while the JS thread is busy — which, on a loading screen, it is by
 * definition.
 */
function Skeleton({ className, style, ...props }: ViewProps) {
	const opacity = React.useRef(new Animated.Value(0.5)).current;

	React.useEffect(() => {
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
				Animated.timing(opacity, { toValue: 0.5, duration: 800, useNativeDriver: true }),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [opacity]);

	return (
		<Animated.View style={[{ opacity }, style]}>
			<View className={cn("rounded-md bg-muted", className)} {...props} />
		</Animated.View>
	);
}

export { Skeleton };
