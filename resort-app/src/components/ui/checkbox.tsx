import * as React from "react"
import { Checkbox as CarbonCheckbox } from "@carbon/react"

type CheckedState = boolean | "indeterminate"

export interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "checked" | "onChange" | "id"
  > {
  id?: string
  checked?: CheckedState
  onCheckedChange?: (checked: CheckedState) => void
  "aria-label"?: string
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ id, checked, onCheckedChange, className, ...props }, ref) => {
    const generatedId = React.useId()
    const resolvedId = id ?? generatedId
    const isIndeterminate = checked === "indeterminate"

    return (
      <CarbonCheckbox
        ref={ref}
        id={resolvedId}
        className={className}
        labelText={props["aria-label"] ?? ""}
        hideLabel
        checked={isIndeterminate ? false : Boolean(checked)}
        indeterminate={isIndeterminate}
        onChange={(_evt, data) => onCheckedChange?.(data.checked)}
        {...props}
      />
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
