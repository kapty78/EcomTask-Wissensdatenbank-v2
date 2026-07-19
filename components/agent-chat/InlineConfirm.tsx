"use client"

/**
 * WP-F4 — InlineConfirm: zweistufige Bestaetigung ohne Popup.
 * Erster Klick wechselt den Button inline zu Bestaetigen/Abbrechen; nach 3 s ohne
 * Entscheidung faellt er automatisch zurueck. Designkonform (keine
 * Dialoge, Pink-Akzent nur fuer Auswahl).
 */

import { useEffect, useRef, useState } from "react"
import { Check, Trash2, X } from "lucide-react"
import { useLanguage } from "@/contexts/LanguageContext"

type Props = {
  onConfirm: () => void
  /** Tooltip/aria-Label des Ausloesers (Default: uebersetztes "Loeschen"). */
  title?: string
  /** Eigener Ausloeser-Inhalt (Default: Trash-Icon). */
  children?: React.ReactNode
  className?: string
}

export function InlineConfirm({ onConfirm, title, children, className }: Props) {
  const { t } = useLanguage()
  const resolvedTitle = title ?? t("general.delete")
  const [armed, setArmed] = useState(false)
  const resetTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
  }, [])

  const arm = (e: React.MouseEvent) => {
    e.stopPropagation()
    setArmed(true)
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setArmed(false), 3000)
  }

  const confirm = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    setArmed(false)
    onConfirm()
  }

  const cancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    setArmed(false)
  }

  if (armed) {
    return (
      <span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={confirm}
          className="flex items-center justify-center size-5 rounded text-red-400 hover:text-red-300 hover:bg-red-400/10"
          title={t("agentChatCore.delete.confirmTitle")}
          aria-label={t("agentChatCore.delete.confirmAriaLabel")}
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          className="flex items-center justify-center size-5 rounded text-muted-foreground hover:text-foreground"
          title={t("general.cancel")}
          aria-label={t("agentChatCore.delete.cancelAriaLabel")}
        >
          <X className="size-3.5" />
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={arm}
      className={className || "flex items-center justify-center size-5 rounded text-muted-foreground hover:text-red-400"}
      title={resolvedTitle}
      aria-label={resolvedTitle}
    >
      {children ?? <Trash2 className="size-3" />}
    </button>
  )
}
