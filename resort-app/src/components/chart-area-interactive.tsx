import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
const chartData = [
  { date: "2026-06-01", desktop: 72, mobile: 58 },
  { date: "2026-06-02", desktop: 76, mobile: 61 },
  { date: "2026-06-03", desktop: 78, mobile: 64 },
  { date: "2026-06-04", desktop: 81, mobile: 66 },
  { date: "2026-06-05", desktop: 86, mobile: 70 },
  { date: "2026-06-06", desktop: 92, mobile: 74 },
  { date: "2026-06-07", desktop: 96, mobile: 76 },
  { date: "2026-06-08", desktop: 88, mobile: 72 },
  { date: "2026-06-09", desktop: 84, mobile: 69 },
  { date: "2026-06-10", desktop: 87, mobile: 71 },
  { date: "2026-06-11", desktop: 91, mobile: 74 },
  { date: "2026-06-12", desktop: 99, mobile: 82 },
  { date: "2026-06-13", desktop: 108, mobile: 91 },
  { date: "2026-06-14", desktop: 112, mobile: 94 },
  { date: "2026-06-15", desktop: 104, mobile: 88 },
  { date: "2026-06-16", desktop: 101, mobile: 84 },
  { date: "2026-06-17", desktop: 106, mobile: 89 },
  { date: "2026-06-18", desktop: 113, mobile: 96 },
  { date: "2026-06-19", desktop: 124, mobile: 104 },
  { date: "2026-06-20", desktop: 136, mobile: 116 },
  { date: "2026-06-21", desktop: 142, mobile: 121 },
  { date: "2026-06-22", desktop: 129, mobile: 110 },
  { date: "2026-06-23", desktop: 122, mobile: 103 },
  { date: "2026-06-24", desktop: 128, mobile: 108 },
  { date: "2026-06-25", desktop: 134, mobile: 115 },
  { date: "2026-06-26", desktop: 149, mobile: 127 },
  { date: "2026-06-27", desktop: 161, mobile: 136 },
  { date: "2026-06-28", desktop: 168, mobile: 142 },
  { date: "2026-06-29", desktop: 154, mobile: 132 },
  { date: "2026-06-30", desktop: 147, mobile: 125 },
]

const chartConfig = {
  visitors: {
    label: "Room nights",
  },
  desktop: {
    label: "Direct and corporate",
    color: "hsl(var(--chart-1))",
  },
  mobile: {
    label: "OTA and agents",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("30d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2026-06-30")
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  return (
    <Card>
      <CardHeader className="relative">
        <CardTitle>Booking pace</CardTitle>
        <CardDescription>
          <span className="hidden sm:block">
            Mocked room-night pickup by channel for the current month
          </span>
          <span className="sm:hidden">Room-night pickup</span>
        </CardDescription>
        <div className="absolute right-4 top-4">
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="hidden md:flex"
          >
            <ToggleGroupItem value="90d" className="h-8 px-2.5">
              Last 3 months
            </ToggleGroupItem>
            <ToggleGroupItem value="30d" className="h-8 px-2.5">
              Last 30 days
            </ToggleGroupItem>
            <ToggleGroupItem value="7d" className="h-8 px-2.5">
              Last 7 days
            </ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="flex w-40 md:hidden"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillDesktop" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-desktop)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-desktop)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillMobile" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-mobile)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-mobile)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value)
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="mobile"
              type="natural"
              fill="url(#fillMobile)"
              stroke="var(--color-mobile)"
              stackId="a"
            />
            <Area
              dataKey="desktop"
              type="natural"
              fill="url(#fillDesktop)"
              stroke="var(--color-desktop)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
