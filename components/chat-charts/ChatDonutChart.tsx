"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { useLanguage } from "@/contexts/LanguageContext"

export interface ChatDonutChartProps {
  title?: string
  subtitle?: string
  data: Array<{ name: string; value: number; color?: string }>
  height?: number
  centerLabel?: string
  centerValue?: string | number
}

const DEFAULT_COLORS = ["#f381cf", "#d96db5", "#c05a9c", "#a64783", "#e074b8", "#f9a8d4", "#7a7a7a", "#555555"]

// Force all colors into our pink/gray palette — override any green/red/blue the agent sends
const ALLOWED_PALETTE = ["#f381cf", "#d96db5", "#c05a9c", "#a64783", "#e074b8", "#f9a8d4", "#7a7a7a", "#555555", "#999999", "#333333"]
function sanitizeColor(color: string | undefined, index: number): string {
  if (!color) return DEFAULT_COLORS[index % DEFAULT_COLORS.length]
  const lower = color.toLowerCase()
  // Allow any color that's already in our palette or is a shade of gray/pink
  if (ALLOWED_PALETTE.includes(lower)) return color
  if (/^#[0-9a-f]{3,8}$/.test(lower)) {
    // Check if it's a gray (r≈g≈b) or pinkish
    const r = parseInt(lower.slice(1, 3), 16)
    const g = parseInt(lower.slice(3, 5), 16)
    const b = parseInt(lower.slice(5, 7), 16)
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b))
    if (maxDiff < 30) return color // gray
    if (r > g && r > b && b > g) return color // pinkish
  }
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length]
}

function CustomTooltip({ active, payload }: any) {
  const { language } = useLanguage()
  const localeCode = language === "de" ? "de-DE" : language === "es" ? "es-ES" : "en-US"
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="rounded-lg border border-white/10 bg-[#191919]/95 px-3 py-2 shadow-xl">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="size-2 rounded-full" style={{ backgroundColor: entry.payload.fill }} />
        <span className="text-white/70">{entry.name}:</span>
        <span className="font-mono font-semibold text-white">{entry.value?.toLocaleString(localeCode)}</span>
      </div>
    </div>
  )
}

export function ChatDonutChart({ title, subtitle, data, height = 200, centerLabel, centerValue }: ChatDonutChartProps) {
  const { language } = useLanguage()
  const localeCode = language === "de" ? "de-DE" : language === "es" ? "es-ES" : "en-US"
  const total = data.reduce((acc, d) => acc + d.value, 0)

  return (
    <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-card/80 p-4 space-y-3">
      {(title || subtitle) && (
        <div>
          {title && <h4 className="text-[13px] font-semibold text-white/90">{title}</h4>}
          {subtitle && <p className="text-[11px] text-white/40 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="flex items-center gap-6">
        <div className="relative" style={{ width: height, height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="85%"
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {data.map((entry, index) => (
                  <Cell key={index} fill={sanitizeColor(entry.color, index)} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          {(centerLabel || centerValue) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {centerValue && <span className="text-lg font-bold font-mono text-white">{typeof centerValue === "number" ? centerValue.toLocaleString(localeCode) : centerValue}</span>}
              {centerLabel && <span className="text-[10px] text-white/40">{centerLabel}</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {data.map((entry, index) => {
            const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0"
            return (
              <div key={index} className="flex items-center gap-2">
                <span className="size-2 rounded-full flex-shrink-0" style={{ backgroundColor: sanitizeColor(entry.color, index) }} />
                <span className="text-[11px] text-white/60 truncate flex-1">{entry.name}</span>
                <span className="text-[11px] font-mono text-white/80 flex-shrink-0">{pct}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
