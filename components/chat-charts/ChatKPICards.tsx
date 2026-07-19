"use client"

import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { useLanguage } from "@/contexts/LanguageContext"

export interface KPICard {
  label: string
  value: string | number
  change?: number
  changeLabel?: string
  icon?: string
}

export interface ChatKPICardsProps {
  title?: string
  cards: KPICard[]
}

function TrendBadge({ change }: { change: number }) {
  if (change === 0) {
    return (
      <div className="flex items-center gap-0.5 text-[10px] font-medium text-white/40">
        <Minus className="size-3" />
        <span>0%</span>
      </div>
    )
  }
  const isPositive = change > 0
  return (
    <div className={`flex items-center gap-0.5 text-[10px] font-medium ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
      {isPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      <span>{isPositive ? "+" : ""}{change.toFixed(1)}%</span>
    </div>
  )
}

export function ChatKPICards({ title, cards }: ChatKPICardsProps) {
  const { language } = useLanguage()
  const localeCode = language === "de" ? "de-DE" : language === "es" ? "es-ES" : "en-US"
  return (
    <div className="space-y-2.5">
      {title && <h4 className="text-[13px] font-semibold text-white/90">{title}</h4>}
      <div className="grid grid-cols-2 gap-2">
        {cards.map((card, i) => (
          <div key={i} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-card/80 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">{card.label}</span>
              {card.icon && <span className="text-sm">{card.icon}</span>}
            </div>
            <div className="flex items-end gap-2">
              <span className="text-xl font-bold font-mono text-white tracking-tight">
                {typeof card.value === "number" ? card.value.toLocaleString(localeCode) : card.value}
              </span>
              {typeof card.change === "number" && <TrendBadge change={card.change} />}
            </div>
            {card.changeLabel && (
              <p className="text-[10px] text-white/30">{card.changeLabel}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
