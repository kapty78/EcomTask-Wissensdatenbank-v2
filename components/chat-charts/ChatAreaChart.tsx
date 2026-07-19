"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useLanguage } from "@/contexts/LanguageContext"

export interface ChatAreaChartProps {
  title?: string
  subtitle?: string
  data: Array<Record<string, string | number>>
  xKey: string
  series: Array<{ key: string; label: string; color: string }>
  height?: number
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
          <span className="text-white/70">{entry.name}:</span>
          <span className="font-mono font-semibold text-white">{entry.value?.toLocaleString(localeCode)}</span>
        </div>
      ))}
    </div>
  )
}

const AREA_COLORS = ["#f381cf", "#d96db5", "#c05a9c", "#a64783", "#e074b8", "#f9a8d4", "#7a7a7a", "#555555"]
const NON_PINK_RE = /^#(?:(?:[0-4][0-9a-f]|[6-9a-f][0-9a-f])[0-9a-f]{4})$/i // rough: not pink/gray

export function ChatAreaChart({ title, subtitle, data, xKey, series: rawSeries, height = 260 }: ChatAreaChartProps) {
  const series = rawSeries.map((s, i) => {
    if (!s.color) return { ...s, color: AREA_COLORS[i % AREA_COLORS.length] }
    // Replace any non-pink color (blue, green, red, etc.) with our palette
    const c = s.color.toLowerCase()
    const isPink = c.startsWith("#f") || c.startsWith("#d9") || c.startsWith("#c0") || c.startsWith("#a6") || c.startsWith("#e0")
    const isGray = /^#([0-9a-f])\1{5}$/i.test(c) || /^#[3-9a-f][0-9a-f]{5}$/i.test(c) && Math.abs(parseInt(c.slice(1,3),16) - parseInt(c.slice(3,5),16)) < 20
    if (isPink || isGray) return s
    return { ...s, color: AREA_COLORS[i % AREA_COLORS.length] }
  })
  return (
    <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-card/80 p-4 space-y-3">
      {(title || subtitle) && (
        <div>
          {title && <h4 className="text-[13px] font-semibold text-white/90">{title}</h4>}
          {subtitle && <p className="text-[11px] text-white/40 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-3 mb-1">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-[10px] text-white/50">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="[&_.recharts-wrapper]:!overflow-visible [&_svg]:overflow-visible" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 12, left: 4, bottom: 5 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`gradient-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#999" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} tickLine={false} dy={6} height={40} />
          <YAxis tick={{ fontSize: 11, fill: "#999" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} tickLine={false} width={45} />
          <Tooltip content={<CustomTooltip />} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#gradient-${s.key})`}
              dot={false}
              activeDot={{ r: 4, stroke: s.color, strokeWidth: 2, fill: "#141418" }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </div>
  )
}
