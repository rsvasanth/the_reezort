import * as React from "react"
import { Toggle as CarbonToggle } from "@carbon/react"

export interface SwitchProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "checked" | "onChange" | "id"
  > {
  id?: string
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  "aria-label"?: string
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ id, checked, onCheckedChange, className, ...props }, ref) => {
    const generatedId = React.useId()
    const resolvedId = id ?? generatedId

    return (
      <CarbonToggle
        ref={ref}
        id={resolvedId}
        className={className}
        size="sm"
        labelText={props["aria-label"] ?? ""}
        hideLabel
        toggled={Boolean(checked)}
        onToggle={(next) => onCheckedChange?.(next)}
        {...props}
      />
    )
  }
)
Switch.displayName = "Switch"

export { Switch }
