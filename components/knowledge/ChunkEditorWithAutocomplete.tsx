"use client"

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react"

interface ChunkEditorWithAutocompleteProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autocompleteEnabled?: boolean
}

// Architecture:
// - Textarea text is transparent when suggestion is active → caret still visible
// - Mirror shows: textBefore (white) + suggestion (gray) + textAfter (white)
// - BOTH textarea and mirror have overflow-y: scroll → identical scrollbar width → identical text wrapping
// - textBefore is the same string in both → wraps identically → no shift before cursor

export function ChunkEditorWithAutocomplete({
  value,
  onChange,
  placeholder,
  autocompleteEnabled = true,
}: ChunkEditorWithAutocompleteProps) {
  const [suggestion, setSuggestion] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const suggestionAnchorRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRequestedTextRef = useRef("")

  const clearSuggestion = useCallback(() => {
    setSuggestion("")
    suggestionAnchorRef.current = null
  }, [])

  const acceptSuggestion = useCallback(() => {
    const anchor = suggestionAnchorRef.current
    if (!suggestion || anchor === null) return
    onChange(value.slice(0, anchor) + suggestion + value.slice(anchor))

    const newPos = anchor + suggestion.length
    clearSuggestion()

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newPos
        textareaRef.current.selectionEnd = newPos
        textareaRef.current.focus()
      }
    })
  }, [suggestion, value, onChange, clearSuggestion])

  const fetchSuggestion = useCallback(async (textBeforeCursor: string, anchorPos: number) => {
    if (abortControllerRef.current) abortControllerRef.current.abort()

    if (!textBeforeCursor || textBeforeCursor.trim().length < 10) {
      clearSuggestion()
      return
    }

    if (textBeforeCursor === lastRequestedTextRef.current) return
    lastRequestedTextRef.current = textBeforeCursor

    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    try {
      const res = await fetch("/api/knowledge/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textBeforeCursor }),
        signal: controller.signal,
      })
      if (!res.ok) { clearSuggestion(); return }

      const data = await res.json()
      if (!controller.signal.aborted && data.suggestion) {
        setSuggestion(data.suggestion)
        suggestionAnchorRef.current = anchorPos
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") clearSuggestion()
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [clearSuggestion])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const newCursorPos = e.target.selectionStart
      onChange(newValue)
      clearSuggestion()

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (autocompleteEnabled) {
        debounceTimerRef.current = setTimeout(() => {
          fetchSuggestion(newValue.slice(0, newCursorPos), newCursorPos)
        }, 600)
      }
    },
    [onChange, fetchSuggestion, clearSuggestion, autocompleteEnabled]
  )

  const handleMouseDown = useCallback(() => {
    if (suggestion) clearSuggestion()
  }, [suggestion, clearSuggestion])

  const handleDoubleClick = useCallback(() => {
    if (suggestion) acceptSuggestion()
  }, [suggestion, acceptSuggestion])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab" && suggestion) { e.preventDefault(); acceptSuggestion(); return }
      if (e.key === "Escape" && suggestion) { e.preventDefault(); clearSuggestion(); return }
      if (suggestion && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
        clearSuggestion()
      }
    },
    [suggestion, acceptSuggestion, clearSuggestion]
  )

  // Sync mirror scroll with textarea
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return
    mirror.scrollTop = textarea.scrollTop
    const sync = () => { mirror.scrollTop = textarea.scrollTop }
    textarea.addEventListener("scroll", sync)
    return () => textarea.removeEventListener("scroll", sync)
  })

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  // Clear everything when autocomplete is toggled off — no API calls, no spinner
  useEffect(() => {
    if (!autocompleteEnabled) {
      clearSuggestion()
      setIsLoading(false)
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null }
      if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
    }
  }, [autocompleteEnabled, clearSuggestion])

  const hasSuggestion = suggestion.length > 0
  const anchor = suggestionAnchorRef.current ?? 0
  const textColor = "hsl(var(--foreground))"

  // Identical styles for textarea and mirror — including overflow-y: scroll
  // so both always have a scrollbar → identical content width → identical wrapping
  const sharedStyles: React.CSSProperties = {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: "0.875rem",
    lineHeight: "1.625",
    padding: "12px",
    wordBreak: "break-word" as const,
    overflowWrap: "break-word" as const,
    whiteSpace: "pre-wrap" as const,
    letterSpacing: "normal",
    tabSize: 4,
    boxSizing: "border-box" as const,
    borderWidth: "1px",
    borderStyle: "solid",
    overflowY: "scroll" as const,
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="relative flex-1 min-h-0">
        {/* Textarea — text transparent when suggestion active, visible otherwise */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          className="absolute inset-0 w-full h-full resize-none rounded text-sm focus:outline-none placeholder:text-muted-foreground"
          style={{
            ...sharedStyles,
            color: hasSuggestion ? "transparent" : textColor,
            caretColor: "white",
            borderColor: "hsl(var(--border))",
            backgroundColor: "transparent",
            zIndex: 1,
          }}
          placeholder={placeholder}
          autoFocus
        />

        {/* Mirror — textBefore (white) + suggestion (gray) + textAfter (white).
            Same overflow-y: scroll as textarea → same scrollbar → same content width.
            textBefore is identical text → wraps identically → cursor position stable. */}
        {hasSuggestion && (
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className="absolute inset-0 rounded pointer-events-none"
            style={{
              ...sharedStyles,
              borderColor: "transparent",
              zIndex: 2,
            }}
          >
            <span style={{ color: textColor }}>{value.slice(0, anchor)}</span>
            <span style={{ color: "rgba(140, 140, 160, 0.5)" }}>{suggestion}</span>
            <span style={{ color: textColor }}>{value.slice(anchor)}</span>
          </div>
        )}
      </div>

      {/* Tab hint */}
      {hasSuggestion && (
        <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/90 border border-border/50 text-[10px] text-muted-foreground select-none pointer-events-none">
          <kbd className="px-1 py-0.5 rounded bg-zinc-700 text-muted-foreground font-mono text-[9px]">Tab</kbd>
          <span>zum Annehmen</span>
        </div>
      )}

      {isLoading && (
        <div className="absolute top-2 right-2 z-20 pointer-events-none">
          <div className="size-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70 animate-spin" />
        </div>
      )}
    </div>
  )
}
