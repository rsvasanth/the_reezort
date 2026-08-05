import * as React from "react";
import { Modal, Pressable, View } from "react-native";

import { cn } from "./lib/cn";
import { Text } from "./text";

/**
 * The native counterpart of the web sheet — a bottom sheet, not a side panel.
 *
 * This is a rethink rather than a port. On web, Sheet slides in from an edge and
 * `side` is a real choice. On a handset the reachable edge is the bottom, and a
 * left-edge panel collides with the system back gesture, so `side` is
 * deliberately absent rather than accepted-and-ignored.
 *
 * Built on RN's Modal for the same reasons as Dialog: a real platform window, no
 * portal host required, and the Android back button wired via onRequestClose.
 */
type SheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children?: React.ReactNode;
};

function Sheet({ open, onOpenChange, children }: SheetProps) {
	return (
		<Modal
			visible={open}
			transparent
			animationType="slide"
			statusBarTranslucent
			onRequestClose={() => onOpenChange(false)}
		>
			<Pressable className="flex-1 justify-end bg-foreground/50" onPress={() => onOpenChange(false)}>
				<Pressable onPress={(e) => e.stopPropagation()}>{children}</Pressable>
			</Pressable>
		</Modal>
	);
}

const SheetContent = React.forwardRef<
	React.ElementRef<typeof View>,
	React.ComponentPropsWithoutRef<typeof View>
>(({ className, children, ...props }, ref) => (
	<View
		ref={ref}
		className={cn("gap-4 rounded-t-2xl border-t border-border bg-card p-6 pb-10", className)}
		{...props}
	>
		{/* Grab handle: the affordance that tells a thumb this is draggable-looking
		    and dismissible, which a bare panel does not communicate. */}
		<View className="mb-2 h-1 w-10 self-center rounded-full bg-muted-foreground/40" />
		{children}
	</View>
));
SheetContent.displayName = "SheetContent";

const SheetHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof View>) => (
	<View className={cn("gap-1.5", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof View>) => (
	<View className={cn("flex-row justify-end gap-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
	React.ElementRef<typeof Text>,
	React.ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => (
	<Text ref={ref} role="heading" className={cn("text-lg font-semibold", className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
	React.ElementRef<typeof Text>,
	React.ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => (
	<Text ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = "SheetDescription";

export { Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
