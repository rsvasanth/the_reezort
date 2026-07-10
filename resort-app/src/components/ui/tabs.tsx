import * as React from "react"
import {
  Tabs as CarbonTabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from "@carbon/react"

interface TabsListProps {
  className?: string
  "data-testid"?: string
  "aria-label"?: string
  children?: React.ReactNode
}
const TabsList = (_props: TabsListProps) => null

interface TabsTriggerProps {
  value: string
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}
const TabsTrigger = (_props: TabsTriggerProps) => null

interface TabsContentProps {
  value: string
  className?: string
  children?: React.ReactNode
}
const TabsContent = (_props: TabsContentProps) => null

interface TabsProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  className?: string
  children?: React.ReactNode
}

// Bounded recursion helper: only walks through plain host elements (div,
// span, ...), never into another component's internals. Radix's TabsList
// doesn't have to be a direct child of Tabs — e.g. data-table.tsx nests it
// inside a flex <div> alongside a Select and action buttons — so a shallow
// direct-children scan silently drops the whole tab section whenever that
// happens (found via browser verification: the cockpit's data table section
// rendered as nothing at all).
function isHostElement(child: React.ReactElement): boolean {
  return typeof child.type === "string"
}

function collectTabsList(node: React.ReactNode): React.ReactElement<TabsListProps> | null {
  let found: React.ReactElement<TabsListProps> | null = null
  React.Children.forEach(node, (child) => {
    if (found || !React.isValidElement(child)) return
    if (child.type === TabsList) {
      found = child as React.ReactElement<TabsListProps>
    } else if (isHostElement(child) && (child.props as { children?: React.ReactNode }).children) {
      found = collectTabsList((child.props as { children?: React.ReactNode }).children)
    }
  })
  return found
}

function collectTabsContent(
  node: React.ReactNode,
  out: React.ReactElement<TabsContentProps>[]
) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === TabsContent) {
      out.push(child as React.ReactElement<TabsContentProps>)
    } else if (isHostElement(child) && (child.props as { children?: React.ReactNode }).children) {
      collectTabsContent((child.props as { children?: React.ReactNode }).children, out)
    }
  })
}

function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps) {
  const listNode = collectTabsList(children)
  const contentNodes: React.ReactElement<TabsContentProps>[] = []
  collectTabsContent(children, contentNodes)

  const triggers: React.ReactElement<TabsTriggerProps>[] = []
  if (listNode) {
    React.Children.forEach(listNode.props.children, (trigger) => {
      if (React.isValidElement(trigger) && trigger.type === TabsTrigger) {
        triggers.push(trigger as React.ReactElement<TabsTriggerProps>)
      }
    })
  }

  const order = triggers.map((t) => t.props.value)
  const [uncontrolled, setUncontrolled] = React.useState(
    defaultValue ?? order[0]
  )
  const value = controlledValue ?? uncontrolled
  const selectedIndex = Math.max(0, order.indexOf(value ?? order[0]))

  const handleChange = (state: { selectedIndex: number }) => {
    const nextValue = order[state.selectedIndex]
    if (nextValue === undefined) return
    if (controlledValue === undefined) setUncontrolled(nextValue)
    onValueChange?.(nextValue)
  }

  const renderedTabList = (
    <TabList
      aria-label={listNode?.props["aria-label"] ?? "Tabs"}
      data-testid={listNode?.props["data-testid"]}
    >
      {triggers.map((t) => (
        <Tab key={t.props.value} disabled={t.props.disabled}>
          {t.props.children}
        </Tab>
      ))}
    </TabList>
  )

  // Rebuild the original tree in place: swap TabsList for the real TabList
  // wherever it was, drop TabsContent from wherever it was (it's rendered
  // separately below via TabPanels), and leave every other host element —
  // the Label/Select/action-buttons row in data-table.tsx, for instance —
  // exactly where the consumer put it.
  function transform(node: React.ReactNode): React.ReactNode {
    return React.Children.map(node, (child) => {
      if (!React.isValidElement(child)) return child
      if (child.type === TabsList) return renderedTabList
      if (child.type === TabsContent) return null
      if (isHostElement(child) && (child.props as { children?: React.ReactNode }).children) {
        return React.cloneElement(
          child,
          undefined,
          transform((child.props as { children?: React.ReactNode }).children)
        )
      }
      return child
    })
  }

  const contentByValue = new Map(
    contentNodes.map((c) => [c.props.value, c.props])
  )

  return (
    <div className={className}>
      <CarbonTabs selectedIndex={selectedIndex} onChange={handleChange}>
        {transform(children)}
        <TabPanels>
          {order.map((v) => {
            const content = contentByValue.get(v)
            return (
              <TabPanel key={v} className={content?.className}>
                {v === value ? content?.children : null}
              </TabPanel>
            )
          })}
        </TabPanels>
      </CarbonTabs>
    </div>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
