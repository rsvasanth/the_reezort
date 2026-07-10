import * as React from "react"
import {
  Select as CarbonSelect,
  SelectItem as CarbonSelectItem,
} from "@carbon/react"

interface SelectItemProps {
  value: string
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}
const SelectItem = (_props: SelectItemProps) => null

interface SelectGroupProps {
  children?: React.ReactNode
}
const SelectGroup = (_props: SelectGroupProps) => null

interface SelectValueProps {
  placeholder?: string
}
const SelectValue = (_props: SelectValueProps) => null

interface SelectTriggerProps {
  id?: string
  className?: string
  "data-testid"?: string
  children?: React.ReactNode
}
const SelectTrigger = (_props: SelectTriggerProps) => null

interface SelectContentProps {
  className?: string
  align?: string
  side?: string
  children?: React.ReactNode
}
const SelectContent = (_props: SelectContentProps) => null

// Unused by any current call site but kept exported for API compatibility.
const SelectLabel = (_props: { children?: React.ReactNode; className?: string }) => null
const SelectSeparator = (_props: { className?: string }) => null

interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  children?: React.ReactNode
}

function textOf(node: React.ReactNode): string {
  return typeof node === "string" ? node : String(node ?? "")
}

function collectItems(
  node: React.ReactNode,
  items: { value: string; text: string; disabled?: boolean }[]
) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectItem) {
      const p = child.props as SelectItemProps
      items.push({ value: p.value, text: textOf(p.children), disabled: p.disabled })
    } else if (child.type === SelectGroup) {
      collectItems((child.props as SelectGroupProps).children, items)
    }
  })
}

function Select({
  value,
  defaultValue,
  onValueChange,
  disabled,
  children,
}: SelectProps) {
  const generatedId = React.useId()
  let triggerId: string | undefined
  let placeholder: string | undefined
  let triggerClassName: string | undefined
  let dataTestId: string | undefined
  const items: { value: string; text: string; disabled?: boolean }[] = []

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectTrigger) {
      const triggerProps = child.props as SelectTriggerProps
      triggerId = triggerProps.id
      triggerClassName = triggerProps.className
      dataTestId = triggerProps["data-testid"]
      React.Children.forEach(triggerProps.children, (inner) => {
        if (React.isValidElement(inner) && inner.type === SelectValue) {
          placeholder = (inner.props as SelectValueProps).placeholder
        }
      })
    } else if (child.type === SelectContent) {
      collectItems((child.props as SelectContentProps).children, items)
    }
  })

  const hasValue = items.some((i) => i.value === value)

  return (
    <CarbonSelect
      id={triggerId ?? generatedId}
      className={triggerClassName}
      data-testid={dataTestId}
      labelText={placeholder ?? "Select"}
      hideLabel
      disabled={disabled}
      value={value}
      defaultValue={defaultValue}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {placeholder && !hasValue && (
        <CarbonSelectItem value="" text={placeholder} hidden disabled />
      )}
      {items.map((item) => (
        <CarbonSelectItem
          key={item.value}
          value={item.value}
          text={item.text}
          disabled={item.disabled}
        />
      ))}
    </CarbonSelect>
  )
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
}
