import * as React from "react"
import { ContentSwitcher, Switch } from "@carbon/react"

interface ToggleGroupItemProps {
  value: string
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}
// Only used as a data-carrying marker read by ToggleGroup below — this
// adapter supports single-select only, matching every current call site.
const ToggleGroupItem = (_props: ToggleGroupItemProps) => null

interface ToggleGroupProps {
  type?: "single"
  value?: string
  onValueChange?: (value: string) => void
  variant?: string
  size?: string
  className?: string
  children?: React.ReactNode
}

function ToggleGroup({ value, onValueChange, className, children }: ToggleGroupProps) {
  const items: { value: string; children: React.ReactNode; disabled?: boolean }[] = []

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === ToggleGroupItem) {
      const p = child.props as ToggleGroupItemProps
      items.push({ value: p.value, children: p.children, disabled: p.disabled })
    }
  })

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value)
  )

  return (
    <ContentSwitcher
      className={className}
      selectedIndex={selectedIndex}
      onChange={(params) => {
        if (params.name !== undefined) onValueChange?.(String(params.name))
      }}
    >
      {items.map((item) => (
        <Switch
          key={item.value}
          name={item.value}
          text={typeof item.children === "string" ? item.children : String(item.children)}
          disabled={item.disabled}
        />
      ))}
    </ContentSwitcher>
  )
}

export { ToggleGroup, ToggleGroupItem }
