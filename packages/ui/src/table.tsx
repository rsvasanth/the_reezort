import * as React from "react";
import { ScrollView, View } from "react-native";

import { cn } from "./lib/cn";
import { Text } from "./text";

/**
 * Row primitives mirroring the web table's export names.
 *
 * READ THIS BEFORE USING IT. A column-aligned table is a tablet and desktop
 * form; on a phone it is the wrong shape, and shrinking one produces a grid
 * nobody can read or tap. Since screens are responsive by width, the rule is:
 *
 *   tablet width  -> Table + TableRow + TableCell, as on web
 *   phone width   -> a Card per record, with the columns as stacked labelled
 *                    fields (see TaskList / TicketList for the pattern)
 *
 * These exist so the tablet branch reads like its web counterpart, not so phone
 * screens can render tables. There is no <table> element in React Native, so
 * these are flex rows — column widths come from the caller via className, since
 * nothing here can measure content the way table layout does.
 */
const Table = React.forwardRef<
	React.ElementRef<typeof View>,
	React.ComponentPropsWithoutRef<typeof View>
>(({ className, ...props }, ref) => (
	<ScrollView horizontal showsHorizontalScrollIndicator={false}>
		<View ref={ref} className={cn("w-full", className)} {...props} />
	</ScrollView>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<
	React.ElementRef<typeof View>,
	React.ComponentPropsWithoutRef<typeof View>
>(({ className, ...props }, ref) => (
	<View ref={ref} className={cn("border-b border-border", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
	React.ElementRef<typeof View>,
	React.ComponentPropsWithoutRef<typeof View>
>(({ className, ...props }, ref) => <View ref={ref} className={className} {...props} />);
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<
	React.ElementRef<typeof View>,
	React.ComponentPropsWithoutRef<typeof View>
>(({ className, ...props }, ref) => (
	<View
		ref={ref}
		className={cn("min-h-12 flex-row items-center border-b border-border", className)}
		{...props}
	/>
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
	React.ElementRef<typeof Text>,
	React.ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => (
	<Text
		ref={ref}
		className={cn("px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground", className)}
		{...props}
	/>
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
	React.ElementRef<typeof Text>,
	React.ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => (
	<Text ref={ref} className={cn("px-3 py-2.5", className)} {...props} />
));
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
