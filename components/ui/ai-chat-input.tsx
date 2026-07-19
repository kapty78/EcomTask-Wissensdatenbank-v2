"use client"

import * as React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { ArrowUp, Image as ImageIcon, Square, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { DynamicLogo } from "@/components/DynamicLogo"
import { INPUT_LOGO_SIZE, INPUT_LOGO_SIZE_COMPACT } from "@/components/sidebar-icon-styles"
import { useLanguage } from "@/contexts/LanguageContext"

interface QuickAction {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  prompt: string
}

interface AIChatInputProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onActivate?: () => void
  onFileSelect?: (files: FileList) => void
  isActive?: boolean
  isLoading?: boolean
  disabled?: boolean
  /** WP-F4: laufenden Agent-Run stoppen — macht den Senden-Button waehrend
   *  isLoading zum Stop-Button (inline, kein Popup). */
  onStop?: () => void
  /** Stoppbar auch OHNE lokalen Stream: es laeuft ein Server-Run fuer die
   *  angezeigte Conversation (Live-Resume nach SSE-Tod ~90s oder History-Wechsel
   *  auf einen laufenden Chat). Dann Stop-Button zeigen + neuen Send blocken,
   *  obwohl isLoading (=isRunning) hier false ist. */
  isStoppable?: boolean
  placeholders?: string[]
  quickActions?: QuickAction[]
  inputRef?: React.RefObject<HTMLInputElement | null>
  fileInputRef?: React.RefObject<HTMLInputElement | null>
  pendingProcessLog?: { folder: string } | null
  onRemoveProcessLog?: () => void
  pendingImages?: { id: string; previewUrl: string; name: string }[]
  onRemoveImage?: (id: string) => void
  chatPanelWidth?: number
  chatPanelOffset?: number
  /** "navbar" = slim single-line bar (36px), "dashboard" = taller input (56px, expands to 120px) */
  variant?: "navbar" | "dashboard"
}

const AIChatInput = React.forwardRef<HTMLDivElement, AIChatInputProps>(({
  value,
  onValueChange,
  onSubmit,
  onActivate,
  isActive: externalIsActive,
  isLoading,
  disabled,
  onStop,
  isStoppable,
  placeholders = ["Support AI Agent..."],
  quickActions = [],
  inputRef: externalInputRef,
  fileInputRef,
  pendingProcessLog,
  onRemoveProcessLog,
  pendingImages = [],
  onRemoveImage,
  chatPanelWidth,
  chatPanelOffset = 0,
  variant = "navbar",
}, ref) => {
  const { t } = useLanguage()
  const isNavbar = variant === "navbar"
  const isDashboard = variant === "dashboard"
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const [showPlaceholder, setShowPlaceholder] = useState(true)
  const internalInputRef = useRef<HTMLInputElement>(null)
  const inputRefToUse = externalInputRef || internalInputRef

  const isActive = externalIsActive ?? false
  const hasContent = value.trim().length > 0 || pendingImages.length > 0 || !!pendingProcessLog

  useEffect(() => {
    if (isActive || hasContent || placeholders.length <= 1) return

    const interval = setInterval(() => {
      setShowPlaceholder(false)
      setTimeout(() => {
        setPlaceholderIndex((prev) => (prev + 1) % placeholders.length)
        setShowPlaceholder(true)
      }, 400)
    }, 3000)

    return () => clearInterval(interval)
  }, [isActive, hasContent, placeholders])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    // Waehrend eines (auch resumten) laufenden Runs kein neuer Send — sonst
    // Doppel-Run in dieselbe Conversation. Der Stop-Button ist dann sichtbar.
    if (!disabled && !isLoading && !isStoppable) onSubmit()
  }, [onSubmit, disabled, isLoading, isStoppable])

  const placeholderContainerVariants = {
    initial: {},
    animate: { transition: { staggerChildren: 0.02 } },
    exit: { transition: { staggerChildren: 0.01, staggerDirection: -1 } },
  }

  const letterVariants = {
    initial: { opacity: 0, filter: "blur(8px)", y: 6 },
    animate: {
      opacity: 1, filter: "blur(0px)", y: 0,
      transition: { opacity: { duration: 0.2 }, filter: { duration: 0.3 }, y: { type: "spring" as const, stiffness: 100, damping: 20 } },
    },
    exit: {
      opacity: 0, filter: "blur(8px)", y: -6,
      transition: { opacity: { duration: 0.15 }, filter: { duration: 0.2 }, y: { type: "spring" as const, stiffness: 100, damping: 20 } },
    },
  }

  return (
    <motion.div
      ref={ref}
      className="w-full"
      initial={false}
      animate={{ height: isDashboard ? (isActive ? 120 : 56) : 36 }}
      transition={{ type: "spring", stiffness: 200, damping: 24 }}
      style={{ overflow: "hidden", borderRadius: isDashboard ? 16 : 12 }}
    >
      <div className="flex flex-col items-stretch w-full h-full">
        {/* Input Row */}
        <form
          onSubmit={handleSubmit}
          className={`flex items-center w-full bg-[#f0f0f0] dark:bg-[#1e1e1e] border border-border ${
            isDashboard ? "gap-2 min-h-[48px] px-3 rounded-2xl" : "gap-1.5 h-9 px-2 rounded-xl"
          }`}
          onClick={onActivate}
        >
          <div className="shrink-0 flex items-center justify-center">
            <DynamicLogo living size={isDashboard ? INPUT_LOGO_SIZE : INPUT_LOGO_SIZE_COMPACT} />
          </div>

          {pendingProcessLog && (
            <div className="relative shrink-0 group inline-flex items-center gap-1 rounded border border-[#f381cf]/30 bg-[#f381cf]/[0.07] px-1.5 py-0.5">
              <svg className="size-3 shrink-0" viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="250" cy="250" r="200" fill="#f381cf" fillOpacity="0.25" />
                <circle cx="250" cy="250" r="120" fill="#f381cf" />
              </svg>
              <span className="text-[9px] font-medium text-[#f381cf] truncate max-w-[80px]">{pendingProcessLog.folder}</span>
              <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onRemoveProcessLog?.() }}
                className="ml-0.5 rounded-full bg-black/60 p-px opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="size-2 text-white" />
              </button>
            </div>
          )}

          {pendingImages.map(img => (
            <div key={img.id} className="relative shrink-0 group">
              <img src={img.previewUrl} alt={img.name} className="h-6 w-6 rounded border border-white/15 object-cover" />
              <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onRemoveImage?.(img.id) }}
                className="absolute -right-0.5 -top-0.5 rounded-full bg-black/80 p-px opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="size-2 text-white" />
              </button>
            </div>
          ))}

          {/* Text Input & Animated Placeholder */}
          <div className={`relative min-w-0 flex-1 flex items-center ${isDashboard ? "min-h-[36px]" : "h-full"}`}>
            <input
              ref={inputRefToUse as React.RefObject<HTMLInputElement>}
              type="text"
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              onFocus={onActivate}
              className={`h-full w-full bg-transparent text-left text-foreground outline-none relative z-[1] ${isDashboard ? "text-sm" : "text-xs"}`}
              aria-label="Support AI Agent"
            />
            {!hasContent && (
              <div className="absolute left-0 top-0 w-full h-full pointer-events-none flex items-center">
                <AnimatePresence mode="wait">
                  {showPlaceholder && !isActive && (
                    <motion.span
                      key={placeholderIndex}
                      className={`absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground select-none pointer-events-none ${isDashboard ? "text-sm" : "text-xs"}`}
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      variants={placeholderContainerVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      {placeholders[placeholderIndex].split("").map((char, i) => (
                        <motion.span key={i} variants={letterVariants} style={{ display: "inline-block" }}>
                          {char === " " ? "\u00A0" : char}
                        </motion.span>
                      ))}
                    </motion.span>
                  )}
                  {isActive && !hasContent && (
                    <motion.span
                      key="active-placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground select-none pointer-events-none ${isDashboard ? "text-sm" : "text-xs"}`}
                    >
                      {t('uiDecorative.chatInput.typeMessage')}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onActivate?.(); fileInputRef?.current?.click() }}
            className={`flex shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors ${isDashboard ? "size-8" : "p-1"}`} aria-label={t('uiDecorative.chatInput.attachImage')}>
            <ImageIcon className={isDashboard ? "size-4" : "size-3.5"} />
          </button>

          {(isLoading || isStoppable) && onStop ? (
            <button
              type="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onStop() }}
              className={`flex shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors ${isDashboard ? "size-8" : "size-6"}`}
              aria-label={t('uiDecorative.chatInput.stop')}
              title={t('uiDecorative.chatInput.stopRun')}
            >
              <Square className={isDashboard ? "size-3" : "size-2.5"} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || isLoading || !hasContent}
              className={`flex shrink-0 items-center justify-center rounded-full transition-colors ${isDashboard ? "size-8" : "size-6"} ${
                hasContent && !disabled && !isLoading
                  ? "bg-foreground text-background"
                  : "bg-muted-foreground/20 text-muted-foreground/40"
              }`}
              aria-label={t('uiDecorative.chatInput.send')}
            >
              <ArrowUp className={isDashboard ? "size-4" : "size-3.5"} />
            </button>
          )}
        </form>

        {/* Expanded Quick Actions — only for dashboard variant */}
        {isDashboard && (
          <motion.div
            className="flex justify-start px-1 items-center"
            variants={{
              hidden: { opacity: 0, y: 8, pointerEvents: "none" as const, transition: { duration: 0.2 } },
              visible: { opacity: 1, y: 0, pointerEvents: "auto" as const, transition: { duration: 0.3, delay: 0.06 } },
            }}
            initial="hidden"
            animate={isActive ? "visible" : "hidden"}
            style={{
              marginTop: 6,
              ...(chatPanelWidth ? { width: `${chatPanelWidth}px`, marginLeft: `${chatPanelOffset}px` } : { width: "100%" }),
            }}
          >
            <div className="flex gap-1.5 overflow-x-auto hide-scrollbar w-full">
              {quickActions.map(action => {
                const Icon = action.icon
                return (
                  <button key={action.id} type="button"
                    onClick={() => { onValueChange(action.prompt); inputRefToUse.current?.focus() }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-black/[0.03] dark:bg-white/[0.03] px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground">
                    <Icon className="size-3" />
                    <span>{action.label}</span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  )
})

AIChatInput.displayName = "AIChatInput"

export { AIChatInput }
export type { AIChatInputProps, QuickAction }
