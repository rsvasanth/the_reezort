import * as React from "react"
import { Popover, PopoverContent } from "@carbon/react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenuCloseContext = React.createContext<() => void>(() => {})

interface DropdownMenuProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

interface DropdownMenuTriggerProps {
  asChild?: boolean
  children: React.ReactElement
}
const DropdownMenuTrigger = ({ children }: DropdownMenuTriggerProps) => children

interface DropdownMenuContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end"
  side?: "top" | "right" | "bottom" | "left"
  sideOffset?: number
  /**
   * Set when the trigger sits inside an ancestor with overflow:hidden (e.g. a
   * Card) that would otherwise clip the menu — switches Carbon's Popover to
   * position:fixed so it escapes that clipping. Opt-in, not the default:
   * fixed positioning also enables floating-ui's flip middleware, whose
   * fallback order tries right/left placements before top ones — for an
   * edge-of-viewport trigger with lots of room to one side (e.g. the sidebar
   * footer's account menu) that picks a placement that visually overlaps the
   * main content pane instead of the originally-intended static placement.
   * Only set this where a real clipping bug is confirmed.
   */
  avoidClipping?: boolean
}
const DropdownMenuContent = ({ children }: DropdownMenuContentProps) => (
  <>{children}</>
)

const ALIGN_MAP: Record<string, string> = {
  start: "bottom-start",
  center: "bottom",
  end: "bottom-end",
}

function DropdownMenu({
  open: controlledOpen,
  onOpenChange,
  children,
}: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = controlledOpen ?? uncontrolledOpen

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange]
  )

  let trigger: React.ReactElement | null = null
  let content: React.ReactNode = null
  let contentProps: DropdownMenuContentProps = {}

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === DropdownMenuTrigger) {
      trigger = (child.props as DropdownMenuTriggerProps).children
    } else if (child.type === DropdownMenuContent) {
      contentProps = child.props as DropdownMenuContentProps
      content = contentProps.children
    }
  })

  if (!trigger) return null

  const triggerElement = trigger as React.ReactElement<{
    onClick?: (e: React.MouseEvent) => void
  }>
  const clonedTrigger = React.cloneElement(triggerElement, {
    onClick: (e: React.MouseEvent) => {
      triggerElement.props.onClick?.(e)
      setOpen(!open)
    },
  })

  return (
    <Popover
      open={open}
      onRequestClose={() => setOpen(false)}
      align={(ALIGN_MAP[contentProps.align ?? "center"] ?? "bottom") as "bottom" | "bottom-start" | "bottom-end"}
      // See DropdownMenuContentProps.avoidClipping — only escape-clip for
      // consumers that opt in, so edge-of-viewport triggers (e.g. the sidebar
      // footer's account menu) keep their working static placement instead of
      // floating-ui's flip picking a placement that overlaps the content pane.
      autoAlign={contentProps.avoidClipping}
    >
      {clonedTrigger}
      <PopoverContent>
        <div
          role="menu"
          className={cn(
            "min-w-[8rem] overflow-y-auto overflow-x-hidden p-1 text-sm",
            contentProps.className
          )}
          style={{ background: "var(--cds-layer, #fff)", color: "var(--cds-text-primary, #161616)" }}
        >
          <DropdownMenuCloseContext.Provider value={() => setOpen(false)}>
            {content}
          </DropdownMenuCloseContext.Provider>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface DropdownMenuItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  inset?: boolean
}
const DropdownMenuItem = React.forwardRef<HTMLButtonElement, DropdownMenuItemProps>(
  ({ className, inset, onClick, children, ...props }, ref) => {
    const close = React.useContext(DropdownMenuCloseContext)
    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        className={cn(
          "flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-[var(--cds-layer-hover,#e8e8e8)] disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
          inset && "pl-8",
          className
        )}
        onClick={(e) => {
          onClick?.(e)
          close()
        }}
        {...props}
      >
        {children}
      </button>
    )
  }
)
DropdownMenuItem.displayName = "DropdownMenuItem"

interface DropdownMenuCheckboxItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}
const DropdownMenuCheckboxItem = React.forwardRef<
  HTMLButtonElement,
  DropdownMenuCheckboxItemProps
>(({ className, children, checked, onCheckedChange, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="menuitemcheckbox"
    aria-checked={checked}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none transition-colors hover:bg-[var(--cds-layer-hover,#e8e8e8)] disabled:pointer-events-none disabled:opacity-50",
      className
    )}
    onClick={() => onCheckedChange?.(!checked)}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      {checked ? <Check className="h-4 w-4" /> : null}
    </span>
    {children}
  </button>
))
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem"

const DropdownMenuLabel = ({
  className,
  inset,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }) => (
  <div
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props}
  />
)

const DropdownMenuSeparator = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLHRElement>) => (
  <hr
    className={cn("-mx-1 my-1 border-t", className)}
    style={{ borderColor: "var(--cds-border-subtle, #e0e0e0)" }}
    {...props}
  />
)

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...props} />
)

// Unused by any current call site (no submenus/radio groups anywhere in the
// app) but kept exported for API compatibility.
const DropdownMenuGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuSub = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuRadioGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuSubTrigger = DropdownMenuItem
const DropdownMenuSubContent = DropdownMenuContent
const DropdownMenuRadioItem = DropdownMenuCheckboxItem

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
