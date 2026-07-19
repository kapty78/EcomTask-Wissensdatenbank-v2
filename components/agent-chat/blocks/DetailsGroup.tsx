"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

/**
 * Uebergeordnetes Dropdown fuer die auto-generierten Auswertungs-Bloecke
 * (Eval-Protokolle, Varianten, Kriterien, Empfehlungen, Daten-Tabellen …).
 * Sitzt ZWISCHEN Trace und Antwort-Text — die Agenten-Antwort dominiert den
 * Chat, die Details sind eine Zeile, aufklappbar; darin bleiben die
 * einzelnen Bloecke ihrerseits auf-/zuklappbar (User-Feedback 2026-07-08).
 */
export function DetailsGroup({
  count,
  defaultOpen = false,
  children,
}: {
  count: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`group w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02] ${isOpen ? "border-b border-white/[0.06]" : ""}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {isOpen
            ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
            : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />}
          <span className="text-[13px] font-medium text-foreground/80 truncate">Auswertungen &amp; Details</span>
        </span>
        <span className="text-[10px] text-muted-foreground/40 shrink-0">
          {count} {count === 1 ? "Eintrag" : "Einträge"}
        </span>
      </button>
      {isOpen && <div className="p-3 space-y-2.5">{children}</div>}
    </div>
  )
}
