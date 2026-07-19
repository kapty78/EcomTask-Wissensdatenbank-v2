"use client"

import type { AgentRichBlock } from "../types"
import { ChatAreaChart } from "@/components/chat-charts/ChatAreaChart"
import { ChatBarChart } from "@/components/chat-charts/ChatBarChart"
import { ChatDonutChart } from "@/components/chat-charts/ChatDonutChart"
import { ChatKPICards } from "@/components/chat-charts/ChatKPICards"

type ChartBlockData = AgentRichBlock & { type: "chart" }

export function ChartBlock({ block, blockIndex }: { block: ChartBlockData; blockIndex: number }) {
  const { chartType, chartData } = block
  try {
    if (chartType === "kpi") return <ChatKPICards key={`chart-${blockIndex}`} {...chartData} />
    if (chartType === "area") return <ChatAreaChart key={`chart-${blockIndex}`} {...chartData} />
    if (chartType === "bar") return <ChatBarChart key={`chart-${blockIndex}`} {...chartData} />
    if (chartType === "donut") return <ChatDonutChart key={`chart-${blockIndex}`} {...chartData} />
  } catch { return null }
  return null
}
