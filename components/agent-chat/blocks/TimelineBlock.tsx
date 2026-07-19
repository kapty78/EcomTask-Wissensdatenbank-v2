"use client"

import { Check, Circle, Loader2, X } from "lucide-react"
import type { AgentRichBlock } from "../types"

type TimelineBlockData = AgentRichBlock & { type: "timeline" }

const STATUS_STYLES = {
  done: { dot: "bg-[#f381cf] border-[#f381cf]", icon: Check, iconClass: "text-white size-2.5" },
  active: { dot: "bg-[#f381cf]/20 border-[#f381cf]", icon: Loader2, iconClass: "text-[#f381cf] size-2.5 animate-spin" },
  pending: { dot: "bg-transparent border-white/20", icon: Circle, iconClass: "text-white/20 size-2" },
  error: { dot: "bg-red-100 border-red-500 dark:bg-red-500/20 dark:border-red-400", icon: X, iconClass: "text-red-700 dark:text-red-400 size-2.5" },
}

export function TimelineBlock({ block, blockIndex }: { block: TimelineBlockData; blockIndex: number }) {
  const steps = Array.isArray(block.steps) ? block.steps.filter(s => !!s?.id && !!s?.label) : []
  if (steps.length === 0) return null

  return (
    <div key={`timeline-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {block.title && (
        <div className="px-4 py-2.5 border-b border-white/[0.06] text-[13px] font-medium text-foreground/80">{block.title}</div>
      )}
      <div className="px-4 py-3">
        <div className="relative">
          {steps.map((step, i) => {
            const status = step.status || "pending"
            const style = STATUS_STYLES[status] || STATUS_STYLES.pending
            const Icon = style.icon
            const isLast = i === steps.length - 1

            return (
              <div key={step.id} className="flex gap-3 relative">
                {/* Vertical line */}
                {!isLast && (
                  <div className="absolute left-[11px] top-[24px] bottom-0 w-px bg-white/[0.08]" />
                )}
                {/* Dot */}
                <div className={`relative z-10 mt-[2px] flex items-center justify-center size-[22px] rounded-full border-2 shrink-0 ${style.dot}`}>
                  <Icon className={style.iconClass} />
                </div>
                {/* Content */}
                <div className={`pb-4 min-w-0 ${isLast ? "pb-0" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[12.5px] font-medium ${status === "active" ? "text-foreground" : status === "done" ? "text-foreground/80" : "text-foreground/50"}`}>
                      {step.label}
                    </span>
                    {step.timestamp && (
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">{step.timestamp}</span>
                    )}
                  </div>
                  {step.description && (
                    <div className="text-[11.5px] leading-relaxed text-foreground/50 mt-0.5">{step.description}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
