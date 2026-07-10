import * as React from "react"
import {
  Table as CarbonTable,
  TableHead as CarbonTableHead,
  TableBody as CarbonTableBody,
  TableRow as CarbonTableRow,
  TableHeader as CarbonTableHeaderCell,
  TableCell as CarbonTableCell,
} from "@carbon/react"

import { cn } from "@/lib/utils"

// Carbon's naming is inverted from shadcn's: Carbon's `TableHead` is the
// <thead> wrapper (our `TableHeader`), and Carbon's `TableHeader` is the
// sortable <th> cell (our `TableHead`). Kept our own export names as-is —
// all 17+ consumer screens import these names — only the underlying
// elements changed. Table/TableHead(thead)/TableBody don't forward refs in
// Carbon (confirmed no consumer anywhere refs them).

const Table = ({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
  <div className="relative w-full overflow-auto">
    <CarbonTable className={cn("w-full text-sm", className)} {...props} />
  </div>
)
Table.displayName = "Table"

const TableHeader = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  // Carbon's TableHead types its event handlers against the JSX intrinsic
  // "thead" tag rather than HTMLTableSectionElement; functionally identical
  // (it renders a <thead>), just a stricter/different generic parameter.
  <CarbonTableHead
    className={cn("[&_tr]:border-b", className)}
    {...(props as React.HTMLAttributes<"thead">)}
  />
)
TableHeader.displayName = "TableHeader"

const TableBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <CarbonTableBody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
)
TableBody.displayName = "TableBody"

// No Carbon equivalent and unused by every current consumer — kept as a
// plain element for API compatibility only.
const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <CarbonTableRow
    ref={ref}
    className={cn("data-[state=selected]:bg-muted", className)}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  // Carbon's TableHeader types onClick against HTMLButtonElement since it's
  // normally a sortable clickable header; none of our usages pass onClick
  // (headers are static, rendered via TanStack's flexRender), so this is a
  // type-shape mismatch only, not a real behavioral one.
  <CarbonTableHeaderCell
    ref={ref}
    className={cn(
      "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...(props as React.ThHTMLAttributes<HTMLButtonElement & HTMLTableCellElement>)}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <CarbonTableCell
    ref={ref}
    className={cn(
      "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

// No Carbon equivalent and unused by every current consumer — kept as a
// plain element for API compatibility only.
const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
