import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { PanelLeft } from "lucide-react"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }
  return context
}

const SidebarProvider = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    defaultOpen?: boolean
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }
>(
  (
    { defaultOpen = true, open: openProp, onOpenChange: setOpenProp, className, style, children, ...props },
    ref
  ) => {
    const isMobile = useIsMobile()
    const [openMobile, setOpenMobile] = React.useState(false)
    const [_open, _setOpen] = React.useState(defaultOpen)
    const open = openProp ?? _open

    const setOpen = React.useCallback(
      (value: boolean | ((value: boolean) => boolean)) => {
        const openState = typeof value === "function" ? value(open) : value
        if (setOpenProp) {
          setOpenProp(openState)
        } else {
          _setOpen(openState)
        }
        document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
      },
      [setOpenProp, open]
    )

    const toggleSidebar = React.useCallback(() => {
      return isMobile ? setOpenMobile((v) => !v) : setOpen((v) => !v)
    }, [isMobile, setOpen])

    React.useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          toggleSidebar()
        }
      }
      window.addEventListener("keydown", handleKeyDown)
      return () => window.removeEventListener("keydown", handleKeyDown)
    }, [toggleSidebar])

    const state = open ? "expanded" : "collapsed"

    const contextValue = React.useMemo<SidebarContextProps>(
      () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
      [state, open, setOpen, isMobile, openMobile, toggleSidebar]
    )

    return (
      <SidebarContext.Provider value={contextValue}>
        <div
          ref={ref}
          className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)}
          style={style}
          {...props}
        >
          {children}
        </div>
      </SidebarContext.Provider>
    )
  }
)
SidebarProvider.displayName = "SidebarProvider"

// A plain fixed <aside>, replacing Carbon's SideNav. Carbon's version needed
// `isFixedNav` to hide at all on desktop — its `expanded` prop only did anything
// below the "lg" breakpoint, which fought this app's contract of fully hiding
// the sidebar on demand at any width. Here the collapsed state is just a
// transform, and mobile gets an explicit scrim rather than Carbon's built-in one.
const Sidebar = React.forwardRef<
  HTMLElement,
  React.ComponentProps<"div"> & {
    side?: "left" | "right"
    variant?: "sidebar" | "floating" | "inset"
    collapsible?: "offcanvas" | "icon" | "none"
  }
>(({ className, children }, ref) => {
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar()
  const expanded = isMobile ? openMobile : open
  const close = () => (isMobile ? setOpenMobile(false) : setOpen(false))

  return (
    <>
      {isMobile && expanded ? (
        <div
          role="presentation"
          onClick={close}
          className="fixed inset-0 z-40 bg-foreground/40"
        />
      ) : null}
      <aside
        ref={ref}
        aria-label="Side navigation"
        aria-hidden={!expanded}
        style={{ width: SIDE_NAV_WIDTH }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-border",
          "bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-out",
          expanded ? "translate-x-0" : "-translate-x-full",
          className
        )}
      >
        <div className="flex h-full w-full flex-col">{children}</div>
      </aside>
    </>
  )
})
Sidebar.displayName = "Sidebar"

const SidebarTrigger = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar } = useSidebar()
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeft />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
})
SidebarTrigger.displayName = "SidebarTrigger"

// Carbon's SideNav is `position: fixed`, so it's taken out of normal flow —
// content doesn't reflow around it on its own the way it did with the old
// spacer-div trick. This mirrors that by tracking the same expanded state.
const SIDE_NAV_WIDTH = "16rem"

const SidebarInset = React.forwardRef<HTMLDivElement, React.ComponentProps<"main">>(
  ({ className, style, ...props }, ref) => {
    const { isMobile, open } = useSidebar()
    const inset = !isMobile && open ? SIDE_NAV_WIDTH : "0px"
    return (
      <main
        ref={ref}
        className={cn("relative flex w-full flex-1 flex-col", className)}
        style={{
          marginLeft: inset,
          transition: "margin-left 150ms cubic-bezier(0.2, 0, 0.38, 0.9)",
          ...style,
        }}
        {...props}
      />
    )
  }
)
SidebarInset.displayName = "SidebarInset"

const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      // h-12 to mirror SiteHeader exactly — the brand row and the content
      // header must share one height so their bottom borders form a single
      // continuous line. (Was flex-col + p-2 with no fixed height: shadcn-era
      // padding stacked on Carbon's own spacing made this row taller than the
      // 48px header, visibly misaligning the two columns.)
      className={cn("flex h-12 shrink-0 items-center border-b px-2", className)}
      style={{ borderColor: "var(--cds-border-subtle, #e0e0e0)" }}
      {...props}
    />
  )
)
SidebarHeader.displayName = "SidebarHeader"

const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("mt-auto flex flex-col gap-2 border-t p-2", className)}
      style={{ borderColor: "var(--cds-border-subtle, #e0e0e0)" }}
      {...props}
    />
  )
)
SidebarFooter.displayName = "SidebarFooter"

const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2", className)}
      {...props}
    />
  )
)
SidebarContent.displayName = "SidebarContent"

const SidebarGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex w-full min-w-0 flex-col p-2", className)} {...props} />
  )
)
SidebarGroup.displayName = "SidebarGroup"

const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("px-2 pb-1 text-xs font-medium uppercase tracking-wide", className)}
      style={{ color: "var(--cds-text-secondary, #525252)" }}
      {...props}
    />
  )
)
SidebarGroupLabel.displayName = "SidebarGroupLabel"

const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  (props, ref) => <div ref={ref} {...props} />
)
SidebarGroupContent.displayName = "SidebarGroupContent"

// Plain list elements. These were SideNavItems/SideNavItem, which set
// overflow:hidden for label truncation and accepted no style prop — so the
// override had to be an `!important` utility, without which any popover
// anchored inside an item (the nav-user account menu) was clipped to invisible.
// Truncation is handled by `truncate` on the label's own <span>, so nothing here
// needs to clip and the override is gone. Kept as plain functions rather than
// forwardRef, matching the previous signature; nothing passes a ref to either.
function SidebarMenu({ children, className }: React.ComponentProps<"ul">) {
  return <ul className={cn("flex w-full min-w-0 flex-col gap-1", className)}>{children}</ul>
}

function SidebarMenuItem({ children, className }: React.ComponentProps<"li">) {
  return <li className={cn("group/menu-item relative", className)}>{children}</li>
}

const sidebarMenuButtonBase =
  "flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0"

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean
    isActive?: boolean
    size?: "default" | "lg"
    // Previously showed a tooltip only in icon-collapsed mode; this Sidebar
    // no longer has an icon-only state, so it's surfaced as a native title
    // instead of a floating tooltip.
    tooltip?: string
  }
>(({ asChild = false, isActive = false, size = "default", tooltip, className, onPointerDown, onFocus, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  const preFocusScrollTop = React.useRef<number | null>(null)

  return (
    <Comp
      ref={ref}
      title={tooltip}
      data-active={isActive}
      className={cn(
        sidebarMenuButtonBase,
        size === "lg" && "py-2.5",
        "hover:bg-[var(--cds-layer-hover,#e8e8e8)]",
        "data-[active=true]:bg-[var(--cds-layer-selected,#e0e0e0)] data-[active=true]:font-medium",
        className
      )}
      onPointerDown={(e) => {
        // Clicking (not Tab-ing to) a link focuses it, and the browser's
        // native focus handling scrollIntoView's it inside the nearest
        // scrollable ancestor regardless — with the manager role's full
        // 16+ item Operations list, clicking anything near the bottom
        // (e.g. "Analytics") snaps the whole list down, hiding everything
        // above it. `preventDefault` on mousedown doesn't stop this (it's
        // not mousedown-default-action driven — a direct .focus() call
        // triggers the same scroll), so instead: remember the scroll
        // position right before the browser moves it, and restore it in
        // the focus handler below. Keyboard Tab focus doesn't fire
        // pointerdown first, so this doesn't touch that path — scrolling
        // a keyboard-focused item into view is still correct there.
        const container = e.currentTarget.closest<HTMLElement>('[class*="overflow-y-auto"]')
        preFocusScrollTop.current = container?.scrollTop ?? null
        onPointerDown?.(e)
      }}
      onFocus={(e) => {
        if (preFocusScrollTop.current !== null) {
          const container = e.currentTarget.closest<HTMLElement>('[class*="overflow-y-auto"]')
          if (container) container.scrollTop = preFocusScrollTop.current
          preFocusScrollTop.current = null
        }
        onFocus?.(e)
      }}
      {...props}
    />
  )
})
SidebarMenuButton.displayName = "SidebarMenuButton"

// Only ever used by NavDocuments, which nothing in the app renders — kept
// as a plain styled button for API compatibility, not verified in-browser.
const SidebarMenuAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { asChild?: boolean; showOnHover?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      ref={ref}
      className={cn(
        "absolute right-1 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 [&>svg]:size-4 [&>svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
})
SidebarMenuAction.displayName = "SidebarMenuAction"

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
}
