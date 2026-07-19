"use client"

import { ArrowDown, Check, Loader2 } from "lucide-react"
import type { AgentRichBlock } from "../types"
import type { UseChoiceSelectionReturn } from "../hooks/use-choice-selection"
import { MarkdownMessage } from "./MarkdownMessage"
import { useLanguage } from "@/contexts/LanguageContext"

type ChoicesBlockData = AgentRichBlock & { type: "interactive_choices" }

interface InteractiveChoicesProps {
  block: ChoicesBlockData
  blockIndex: number
  messageId: string
  choiceSelection: UseChoiceSelectionReturn
  isThinking: boolean
  onSubmitMessage: (msg: string) => Promise<void>
}

export function InteractiveChoices({ block, blockIndex, messageId, choiceSelection, isThinking, onSubmitMessage }: InteractiveChoicesProps) {
  const { t } = useLanguage()
  const { choiceSelections, choiceErrors, submittingChoiceId, setSubmittingChoiceId, toggleChoice, setChoiceError } = choiceSelection
  const blockKey = `${messageId}:${blockIndex}`
  const options = Array.isArray(block.options) ? block.options.filter(o => !!o?.id && !!o?.label).slice(0, 12) : []
  if (options.length < 2) return null

  const selectionMode: "single" | "multiple" | "either_or" = block.selectionMode === "multiple" ? "multiple" : block.selectionMode === "either_or" ? "either_or" : "single"
  const isMultiSelect = selectionMode === "multiple"
  const selectedIds = choiceSelections[blockKey] || []
  const minSelections = Math.max(0, Math.min(options.length, typeof block.minSelections === "number" ? Math.round(block.minSelections) : 1))
  const maxSelections = Math.max(minSelections || 1, Math.min(options.length, typeof block.maxSelections === "number" ? Math.round(block.maxSelections) : (isMultiSelect ? options.length : 1)))
  const choiceError = choiceErrors[blockKey] || null
  const isSubmitting = submittingChoiceId === blockKey
  const selectedLabels = options.filter(o => selectedIds.includes(o.id)).map(o => o.label)
  const submitDisabled = isThinking || isSubmitting || selectedIds.length < minSelections
  const submitLabel = block.submitLabel || (isMultiSelect ? t('agentChatBlocks.choices.submitMultiLabel') : selectionMode === "either_or" ? t('agentChatBlocks.choices.submitEitherOrLabel') : t('agentChatBlocks.choices.submitSingleLabel'))

  const handleToggle = (optionId: string) => {
    toggleChoice(blockKey, optionId, isMultiSelect, maxSelections)
  }

  const handleSubmit = async () => {
    if (isThinking || isSubmitting) return
    if (selectedIds.length < minSelections) {
      const errorKey = minSelections === 1 ? 'agentChatBlocks.choices.minSelectionsErrorSingular' : 'agentChatBlocks.choices.minSelectionsErrorPlural'
      setChoiceError(blockKey, t(errorKey).replace('{min}', String(minSelections)))
      return
    }
    const responsePrefix = (block.responsePrefix || t('agentChatBlocks.choices.defaultPrefix')).trim()
    setSubmittingChoiceId(blockKey)
    try { await onSubmitMessage(`${responsePrefix}: ${selectedLabels.join(", ")}`) } finally { setSubmittingChoiceId(null) }
  }

  return (
    <div key={`interactive-${blockKey}`} className="rounded-lg border border-border bg-card p-3 space-y-2.5">
      {block.title && <div className="text-[11px] font-medium text-foreground">{block.title}</div>}
      <div className="text-[11.5px] leading-relaxed text-foreground"><MarkdownMessage content={block.prompt} /></div>
      <div className="space-y-1.5">
        {options.map(option => {
          const isSelected = selectedIds.includes(option.id)
          return (
            <button key={`${blockKey}-${option.id}`} type="button" onClick={() => handleToggle(option.id)}
              className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${isSelected ? "border-[#f381cf]/40 bg-[#f381cf]/10 text-foreground" : "border-border bg-white/[0.02] text-muted-foreground hover:border-white/20 hover:text-foreground"}`}>
              <div className="flex items-start gap-2">
                <span className={`mt-[1px] inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border ${isSelected ? "border-[#f381cf] bg-[#f381cf]/80" : "border-white/30"}`}>
                  {isSelected ? <Check className="size-2.5 text-white" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] leading-relaxed text-foreground">{option.label}</span>
                  {option.description && <span className="block text-[10.5px] text-muted-foreground mt-0.5">{option.description}</span>}
                </span>
              </div>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="text-[10.5px] text-muted-foreground">
          {isMultiSelect
            ? t('agentChatBlocks.choices.selectionSummary').replace('{count}', String(selectedIds.length)).replace('{min}', String(minSelections)).replace('{max}', String(maxSelections))
            : selectedIds.length > 0 ? t('agentChatBlocks.choices.oneSelected') : t('agentChatBlocks.choices.pleaseSelectOne')}
        </div>
        <button type="button" onClick={handleSubmit} disabled={submitDisabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-foreground transition-colors hover:border-white/30 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">
          {isSubmitting ? <Loader2 className="size-3 animate-spin" /> : <ArrowDown className="size-3" />}
          <span>{submitLabel}</span>
        </button>
      </div>
      {choiceError && <div className="text-[10.5px] text-muted-foreground">{choiceError}</div>}
    </div>
  )
}
