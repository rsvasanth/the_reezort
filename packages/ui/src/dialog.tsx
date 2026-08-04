import * as React from "react";
import { Modal, Pressable, View } from "react-native";

import { cn } from "./lib/cn";
import { Text } from "./text";

/**
 * Built on React Native's own `Modal` rather than `@rn-primitives/dialog`, which
 * is not a dependency here. RN's Modal already provides what a native dialog
 * needs and rn-primitives cannot: it renders in a real platform window, so it
 * sits above everything without a portal host, and it wires the Android hardware
 * back button to dismiss via `onRequestClose`.
 *
 * The export names mirror the web dialog so screens read the same on both
 * platforms. `DialogPortal`, `DialogOverlay`, `DialogTrigger` and `DialogClose`
 * are intentionally absent — the first two are what Modal already is, and the
 * latter two are trigger patterns that native screens express with a Pressable
 * and their own state. Adding empty shims for them would suggest an API surface
 * that does not exist.
 */
type DialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children?: React.ReactNode;
};

function Dialog({ open, onOpenChange, children }: DialogProps) {
	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			statusBarTranslucent
			onRequestClose={() => onOpenChange(false)}
		>
			<Pressable
				className="flex-1 items-center justify-center bg-foreground/50 p-6"
				onPress={() => onOpenChange(false)}
			>
				{/* Swallow the press so tapping the panel does not dismiss it. */}
				<Pressable className="w-full" onPress={(e) => e.stopPropagation()}>
					{children}
				</Pressable>
			</Pressable>
		</Modal>
	);
}

const DialogContent = React.forwardRef<
	React.ElementRef<typeof View>,
	React.ComponentPropsWithoutRef<typeof View>
>(({ className, ...props }, ref) => (
	<View
		ref={ref}
		className={cn("gap-4 rounded-lg border border-border bg-card p-6", className)}
		{...props}
	/>
));
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof View>) => (
	<View className={cn("gap-1.5", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof View>) => (
	<View className={cn("flex-row justify-end gap-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
	React.ElementRef<typeof Text>,
	React.ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => (
	<Text ref={ref} role="heading" className={cn("text-lg font-semibold", className)} {...props} />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
	React.ElementRef<typeof Text>,
	React.ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => (
	<Text ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";

export { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
