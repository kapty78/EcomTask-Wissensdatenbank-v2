"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { AgentRichBlock } from "../types"
import { useLanguage } from "@/contexts/LanguageContext"

type StatusCardBlockData = AgentRichBlock & { type: "status_card" }

// `status` drives the colour/severity only. The badge TEXT is the AI-authored
// `statusLabel`; these labels are just fallbacks when the AI omits it. The
// in_progress fallback says "Läuft …" (an active state) rather than the old
// "In Bearbeitung", which was misleading on cards that had actually finished.
const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  open: { color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20" },
  in_progress: { color: "text-yellow-800 dark:text-yellow-400", bg: "bg-yellow-100 border-yellow-200 dark:bg-yellow-500/10 dark:border-yellow-500/20" },
  resolved: { color: "text-green-700 dark:text-green-400", bg: "bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/20" },
  closed: { color: "text-muted-foreground", bg: "bg-white/5 border-white/10" },
  escalated: { color: "text-red-700 dark:text-red-400", bg: "bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/20" },
}

export function StatusCardBlock({ block, blockIndex }: { block: StatusCardBlockData; blockIndex: number }) {
  const { t } = useLanguage()
  const fields = Array.isArray(block.fields) ? block.fields.filter(f => !!f?.label) : []
  const style = STATUS_STYLE[block.status] || STATUS_STYLE.open
  const STATUS_LABELS: Record<string, string> = {
    open: t('agentChatBlocks.statusCard.open'),
    in_progress: t('agentChatBlocks.statusCard.inProgress'),
    resolved: t('agentChatBlocks.statusCard.resolved'),
    closed: t('agentChatBlocks.statusCard.closed'),
    escalated: t('agentChatBlocks.statusCard.escalated'),
  }
  const defaultLabel = STATUS_LABELS[block.status] || STATUS_LABELS.open
  const badgeLabel = (block.statusLabel && block.statusLabel.trim()) || defaultLabel

  // Default = zu: Titel + Status-Badge sind die Zusammenfassung; die Feld-
  // Details klappen erst auf Klick auf (gleiches Muster wie InteractiveTable).
  // Die Agenten-Antwort soll den Chat dominieren, nicht die Auswertungs-Karten.
  const hasBody = fields.length > 0 || !!block.updatedAt
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div key={`status-card-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {/* Header with status badge — klickbar, toggled die Details */}
      <button
        type="button"
        onClick={() => hasBody && setIsOpen((v) => !v)}
        className={`group w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${hasBody ? "hover:bg-white/[0.02]" : "cursor-default"} ${isOpen && hasBody ? "border-b border-white/[0.06]" : ""}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {hasBody && (isOpen
            ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
            : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />)}
          <span className="text-[13px] font-medium text-foreground/80 truncate">{block.title}</span>
        </span>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium shrink-0 ${style.bg} ${style.color}`}>
          {badgeLabel}
        </span>
      </button>
      {isOpen && hasBody && (<>
        {/* Fields */}
        {fields.length > 0 && (
          <div className="px-4 py-3 space-y-2">
            {fields.map((field, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4">
                <span className="text-[11.5px] text-muted-foreground/60 shrink-0">{field.label}</span>
                <span className="text-[12px] text-foreground/75 text-right truncate">{field.value}</span>
              </div>
            ))}
          </div>
        )}
        {/* Updated at */}
        {block.updatedAt && (
          <div className="px-4 py-2 border-t border-white/[0.04] text-[10px] text-muted-foreground/40">
            {t('agentChatBlocks.statusCard.updatedAtLabel')} {block.updatedAt}
          </div>
        )}
      </>)}
    </div>
  )
}
