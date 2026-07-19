"use client"

/**
 * WP-F3 — Geteilte Conversation-Liste (Cockpit-Sidebar ≙ Launcher-History).
 * Reine Praesentation: Daten + Callbacks kommen vom Aufrufer. Loeschen
 * laeuft ueber InlineConfirm (WP-F4, kein Popup).
 */

import { useEffect, useRef } from "react"
import { Pencil } from "lucide-react"
import type { ConversationSummary } from "./types"
import { InlineConfirm } from "./InlineConfirm"
import { useLanguage } from "@/contexts/LanguageContext"

type Props = {
  conversations: ConversationSummary[]
  activeConversationId: string | null
  /** Conversation mit aktivem Live-Link (Realtime/Poll) — zeigt Pulse. */
  liveConversationId?: string | null
  loadingConversationId?: string | null
  editingConvId: string | null
  editingTitle: string
  onEditingTitleChange: (value: string) => void
  onSelect: (conv: ConversationSummary) => void
  onStartRename: (conv: ConversationSummary) => void
  onSaveRename: () => void
  onCancelRename: () => void
  onDelete: (conv: ConversationSummary) => void
}

export function ConversationList({
  conversations,
  activeConversationId,
  liveConversationId,
  loadingConversationId,
  editingConvId,
  editingTitle,
  onEditingTitleChange,
  onSelect,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onDelete,
}: Props) {
  const { t, language } = useLanguage()
  const renameInputRef = useRef<HTMLInputElement>(null)
  const localeCode = language === "de" ? "de-DE" : language === "es" ? "es-ES" : "en-US"

  useEffect(() => {
    if (editingConvId) {
      const focusTimer = setTimeout(() => renameInputRef.current?.focus(), 50)
      return () => clearTimeout(focusTimer)
    }
  }, [editingConvId])

  if (conversations.length === 0) {
    return <div className="text-center py-8 text-[11px] text-muted-foreground/50">{t("agentChatCore.history.empty")}</div>
  }

  return (
    <div className="space-y-0.5">
      {conversations.map((conv) => {
        const label =
          conv.title?.trim() ||
          (conv.last_message_preview
            ? conv.last_message_preview.slice(0, 45) + (conv.last_message_preview.length > 45 ? "..." : "")
            : t("agentChatCore.history.untitled"))
        const isActive = conv.id === activeConversationId
        const timeAgo = conv.last_message_at
          ? new Date(conv.last_message_at).toLocaleDateString(localeCode, { day: "2-digit", month: "2-digit" })
          : ""
        const lastTs = conv.last_message_at ? new Date(conv.last_message_at).getTime() : 0
        const recentlyActive = lastTs > 0 && Date.now() - lastTs < 3 * 60 * 1000
        const showPulse = liveConversationId === conv.id || (recentlyActive && !isActive)
        const isLoading = loadingConversationId === conv.id

        return (
          <div
            key={conv.id}
            className={`group flex items-start gap-2 rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${
              isActive ? "bg-[#f381cf]/10 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            onClick={() => { if (!isActive) onSelect(conv) }}
          >
            <div className="flex-1 min-w-0">
              {editingConvId === conv.id ? (
                <input
                  ref={renameInputRef}
                  value={editingTitle}
                  onChange={(e) => onEditingTitleChange(e.target.value)}
                  onBlur={onSaveRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveRename()
                    if (e.key === "Escape") onCancelRename()
                  }}
                  className="w-full bg-transparent text-[12px] text-foreground outline-none border-b border-[#f381cf]/30"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="flex items-center gap-1.5">
                  {showPulse && <span className="size-1.5 shrink-0 rounded-full bg-[#f381cf] animate-pulse" />}
                  <span className="truncate text-[12px] leading-snug">{isLoading ? t("general.loading") : label}</span>
                </div>
              )}
              {timeAgo && <div className="text-[10px] text-muted-foreground/50 mt-0.5">{timeAgo}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                className="flex items-center justify-center size-5 rounded text-muted-foreground hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); onStartRename(conv) }}
                title={t("agentChatCore.rename")}
                aria-label={t("agentChatCore.rename")}
              >
                <Pencil className="size-3" />
              </button>
              <InlineConfirm onConfirm={() => onDelete(conv)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
