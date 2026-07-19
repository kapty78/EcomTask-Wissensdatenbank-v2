"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, XCircle } from "lucide-react"
import type { AgentRichBlock } from "../types"
import { MarkdownMessage } from "./MarkdownMessage"

type AlertBlockData = AgentRichBlock & { type: "alert" }

const SEVERITY_CONFIG = {
  info: { icon: Info, border: "border-blue-200 dark:border-blue-500/20", bg: "bg-blue-50 dark:bg-blue-500/5", iconClass: "text-blue-600 dark:text-blue-400", titleClass: "text-blue-800 dark:text-blue-300" },
  success: { icon: CheckCircle2, border: "border-green-200 dark:border-green-500/20", bg: "bg-green-50 dark:bg-green-500/5", iconClass: "text-green-600 dark:text-green-400", titleClass: "text-green-800 dark:text-green-300" },
  warning: { icon: AlertTriangle, border: "border-yellow-200 dark:border-yellow-500/20", bg: "bg-yellow-100 dark:bg-yellow-500/5", iconClass: "text-yellow-700 dark:text-yellow-400", titleClass: "text-yellow-900 dark:text-yellow-300" },
  error: { icon: XCircle, border: "border-red-200 dark:border-red-500/20", bg: "bg-red-50 dark:bg-red-500/5", iconClass: "text-red-600 dark:text-red-400", titleClass: "text-red-800 dark:text-red-300" },
}

/** Kurze Alerts bleiben inline lesbar; lange (z.B. Eval-Empfehlungen)
 *  klappen default zu — die eigentliche Agenten-Antwort soll den Chat
 *  dominieren, nicht die auto-generierten Auswertungs-Bloecke. */
const COLLAPSE_THRESHOLD_CHARS = 160

export function AlertBlock({ block, blockIndex }: { block: AlertBlockData; blockIndex: number }) {
  const config = SEVERITY_CONFIG[block.severity] || SEVERITY_CONFIG.info
  const Icon = config.icon
  const message = String(block.message || "")
  const collapsible = message.length > COLLAPSE_THRESHOLD_CHARS
  const [isOpen, setIsOpen] = useState(false)

  if (!collapsible) {
    return (
      <div key={`alert-${blockIndex}`} className={`rounded-xl border ${config.border} ${config.bg} p-3.5 flex items-start gap-3`}>
        <Icon className={`size-4.5 shrink-0 mt-0.5 ${config.iconClass}`} />
        <div className="min-w-0 space-y-0.5">
          {block.title && <div className={`text-[12.5px] font-medium ${config.titleClass}`}>{block.title}</div>}
          <div className="text-[12px] leading-relaxed text-foreground/65">
            <MarkdownMessage content={message} />
          </div>
        </div>
      </div>
    )
  }

  const headerLabel = block.title || `${message.slice(0, 80)}…`

  return (
    <div key={`alert-${blockIndex}`} className={`rounded-xl border ${config.border} ${config.bg} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="group w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {isOpen
            ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
            : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />}
          <Icon className={`size-4 shrink-0 ${config.iconClass}`} />
          <span className={`text-[12.5px] font-medium truncate ${config.titleClass}`}>{headerLabel}</span>
        </span>
      </button>
      {isOpen && (
        <div className="px-3.5 pb-3 pl-[42px] text-[12px] leading-relaxed text-foreground/65">
          <MarkdownMessage content={message} />
        </div>
      )}
    </div>
  )
}
