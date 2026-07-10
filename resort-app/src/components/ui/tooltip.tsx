import * as React from "react"
import { Tooltip as CarbonTooltip } from "@carbon/react"

interface TooltipProviderProps {
  children?: React.ReactNode
  delayDuration?: number
  skipDelayDuration?: number
}
const TooltipProvider = ({ children }: TooltipProviderProps) => <>{children}</>

interface TooltipTriggerProps {
  asChild?: boolean
  children: React.ReactElement
}
const TooltipTrigger = ({ children }: TooltipTriggerProps) => children

interface TooltipContentProps {
  className?: string
  children?: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  align?: string
  sideOffset?: number
  hidden?: boolean
}
const TooltipContent = ({ children }: TooltipContentProps) => <>{children}</>

interface TooltipProps {
  children?: React.ReactNode
}

const CARBON_ALIGN = new Set(["top", "right", "bottom", "left"])

function Tooltip({ children }: TooltipProps) {
  let trigger: React.ReactElement | null = null
  let content: React.ReactNode = null
  let align: TooltipContentProps["side"] | undefined

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === TooltipTrigger) {
      trigger = (child.props as TooltipTriggerProps).children
    } else if (child.type === TooltipContent) {
      const contentProps = child.props as TooltipContentProps
      content = contentProps.children
      if (contentProps.side && CARBON_ALIGN.has(contentProps.side)) {
        align = contentProps.side
      }
    }
  })

  if (!trigger) return null

  return (
    <CarbonTooltip label={content} align={align}>
      {trigger}
    </CarbonTooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
