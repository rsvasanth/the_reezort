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

function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps) {
  let listNode: React.ReactElement<TabsListProps> | null = null
  const contentNodes: React.ReactElement<TabsContentProps>[] = []

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === TabsList) {
      listNode = child as React.ReactElement<TabsListProps>
    } else if (child.type === TabsContent) {
      contentNodes.push(child as React.ReactElement<TabsContentProps>)
    }
  })

  const triggers: React.ReactElement<TabsTriggerProps>[] = []
  if (listNode) {
    React.Children.forEach((listNode as React.ReactElement<TabsListProps>).props.children, (trigger) => {
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

  const contentByValue = new Map(
    contentNodes.map((c) => [c.props.value, c.props])
  )

  return (
    <div className={className}>
    <CarbonTabs
      selectedIndex={selectedIndex}
      onChange={handleChange}
    >
      <TabList
        aria-label={(listNode as React.ReactElement<TabsListProps> | null)?.props["aria-label"] ?? "Tabs"}
        data-testid={(listNode as React.ReactElement<TabsListProps> | null)?.props["data-testid"]}
      >
        {triggers.map((t) => (
          <Tab key={t.props.value} disabled={t.props.disabled}>
            {t.props.children}
          </Tab>
        ))}
      </TabList>
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
