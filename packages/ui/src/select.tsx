import * as React from "react";
import * as SelectPrimitive from "@rn-primitives/select";
import { Check, ChevronDown } from "lucide-react-native";

import { cn } from "./lib/cn";
import { TextClassContext } from "./text";

/**
 * Mirrors the web select, including the compound API screens already use.
 *
 * One platform note that matters for layout: SelectContent portals, so it needs
 * a `<PortalHost />` mounted once in the app shell. Without it the list opens
 * into nothing and the failure is silent — the trigger appears dead rather than
 * throwing.
 */
const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

/**
 * `children` is narrowed to ReactNode on Trigger and Item. rn-primitives builds
 * both on Pressable, whose children may also be a render function of press
 * state — a signature these wrappers do not support, since they compose fixed
 * chrome (the chevron, the check indicator) around the caller's content.
 */
type TriggerProps = Omit<SelectPrimitive.TriggerProps, "children"> & {
	children?: React.ReactNode;
};
type ItemProps = Omit<SelectPrimitive.ItemProps, "children"> & { children?: React.ReactNode };

const SelectTrigger = React.forwardRef<SelectPrimitive.TriggerRef, TriggerProps>(
	({ className, children, ...props }, ref) => (
		<SelectPrimitive.Trigger
			ref={ref}
			className={cn(
				"h-12 flex-row items-center justify-between gap-2 rounded-md border border-input bg-background px-3",
				props.disabled && "opacity-50",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronDown size={16} className="text-muted-foreground" />
		</SelectPrimitive.Trigger>
	),
);
SelectTrigger.displayName = "SelectTrigger";

const SelectContent = React.forwardRef<SelectPrimitive.ContentRef, SelectPrimitive.ContentProps>(
	({ className, children, ...props }, ref) => (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Overlay className="bg-foreground/30">
				<SelectPrimitive.Content
					ref={ref}
					className={cn(
						"z-50 min-w-[8rem] rounded-md border border-border bg-popover p-1 shadow-lg",
						className,
					)}
					{...props}
				>
					<SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
				</SelectPrimitive.Content>
			</SelectPrimitive.Overlay>
		</SelectPrimitive.Portal>
	),
);
SelectContent.displayName = "SelectContent";

const SelectLabel = React.forwardRef<SelectPrimitive.LabelRef, SelectPrimitive.LabelProps>(
	({ className, ...props }, ref) => (
		<SelectPrimitive.Label
			ref={ref}
			className={cn("px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground", className)}
			{...props}
		/>
	),
);
SelectLabel.displayName = "SelectLabel";

const SelectItem = React.forwardRef<SelectPrimitive.ItemRef, ItemProps>(
	({ className, children, ...props }, ref) => (
		<TextClassContext.Provider value="text-base text-popover-foreground">
			<SelectPrimitive.Item
				ref={ref}
				className={cn(
					"h-12 w-full flex-row items-center rounded-sm py-1.5 pl-2 pr-8",
					props.disabled && "opacity-50",
					className,
				)}
				{...props}
			>
				<SelectPrimitive.ItemIndicator className="absolute right-2">
					<Check size={16} className="text-foreground" />
				</SelectPrimitive.ItemIndicator>
				<SelectPrimitive.ItemText />
				{children}
			</SelectPrimitive.Item>
		</TextClassContext.Provider>
	),
);
SelectItem.displayName = "SelectItem";

const SelectSeparator = React.forwardRef<SelectPrimitive.SeparatorRef, SelectPrimitive.SeparatorProps>(
	({ className, ...props }, ref) => (
		<SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
	),
);
SelectSeparator.displayName = "SelectSeparator";

export {
	Select,
	SelectGroup,
	SelectValue,
	SelectTrigger,
	SelectContent,
	SelectLabel,
	SelectItem,
	SelectSeparator,
};
