"use client"

import { useRef, useState, useEffect, useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts"
import { useLanguage } from "@/contexts/LanguageContext"

export interface ChatBarChartProps {
  title?: string
  subtitle?: string
  data: Array<Record<string, string | number>>
  xKey: string
  yKey: string
  color?: string
  colors?: string[]
  height?: number
  layout?: "vertical" | "horizontal"
}

function CustomTooltip({ active, payload, label }: any) {
  const { language } = useLanguage()
  const localeCode = language === "de" ? "de-DE" : language === "es" ? "es-ES" : "en-US"
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-[#191919]/95 px-3 py-2 shadow-xl">
      <p className="text-[11px] font-medium text-white/60 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-[12px]">
          <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="font-mono font-semibold text-white">{entry.value?.toLocaleString(localeCode)}</span>
        </div>
      ))}
    </div>
  )
}

const DEFAULT_COLORS = ["#f381cf", "#d96db5", "#c05a9c", "#a64783", "#e074b8", "#f9a8d4", "#7a7a7a", "#555555"]

export function ChatBarChart({ title, subtitle, data, xKey: rawXKey, yKey: rawYKey, color, colors, height = 240, layout = "horizontal" }: ChatBarChartProps) {
  const barColors = colors || (color ? [color] : DEFAULT_COLORS)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(500)

  useEffect(() => {
    if (!containerRef.current) return
    const measure = () => {
      if (containerRef.current) setWidth(containerRef.current.offsetWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Safeguard: if xKey/yKey don't exist in data, find matching keys
  const firstRow = data?.[0] || {}
  const allKeys = Object.keys(firstRow)
  const stringKeys = allKeys.filter(k => typeof firstRow[k] === "string")
  const numberKeys = allKeys.filter(k => typeof firstRow[k] === "number")
  const xKey = (rawXKey && rawXKey in firstRow) ? rawXKey : stringKeys[0] || rawXKey
  const yKey = (rawYKey && rawYKey in firstRow) ? rawYKey : numberKeys[0] || rawYKey

  // Compute Y-axis ticks from data
  const yTicks = useMemo(() => {
    const values = data.map(d => Number(d[yKey]) || 0)
    const max = Math.max(...values, 1)
    const step = max <= 5 ? 1 : max <= 20 ? 5 : max <= 100 ? 20 : max <= 500 ? 100 : Math.ceil(max / 5 / 100) * 100
    const ticks: number[] = []
    for (let v = 0; v <= max; v += step) ticks.push(v)
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
    return ticks
  }, [data, yKey])

  const LEFT_PAD = 48

  return (
    <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-card/80 p-4 space-y-2">
      {(title || subtitle) && (
        <div>
          {title && <h4 className="text-[13px] font-semibold text-white/90">{title}</h4>}
          {subtitle && <p className="text-[11px] text-white/40 mt-0.5">{subtitle}</p>}
        </div>
      )}

      {/* Y-axis labels + Chart */}
      <div className="relative" ref={containerRef}>
        {/* Y-axis labels as HTML */}
        <div className="absolute left-0 top-0 flex flex-col justify-between" style={{ width: LEFT_PAD - 4, height, paddingTop: 10, paddingBottom: 4 }}>
          {[...yTicks].reverse().map((v, i) => (
            <span key={i} className="text-[10px] text-white/40 text-right leading-none font-mono">{v}</span>
          ))}
        </div>

        {/* Chart (no Y-axis labels from recharts, they don't render) */}
        <div style={{ marginLeft: LEFT_PAD }}>
          <BarChart
            width={Math.max(width - LEFT_PAD, 100)}
            height={height}
            data={data}
            layout={layout}
            margin={{ top: 10, right: 8, left: 0, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey={xKey} hide />
            <YAxis hide domain={[0, yTicks[yTicks.length - 1]]} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Bar dataKey={yKey} radius={[4, 4, 0, 0]} maxBarSize={48}>
              {data.map((_, index) => (
                <Cell key={index} fill={barColors[index % barColors.length]} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </div>
      </div>

      {/* X-axis labels as HTML */}
      <div className="flex text-[10px] text-white/40" style={{ paddingLeft: LEFT_PAD }}>
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center truncate px-0.5">{String(d[xKey] || "")}</span>
        ))}
      </div>
    </div>
  )
}
