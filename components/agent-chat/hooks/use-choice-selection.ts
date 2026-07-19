"use client"

import { useState, useCallback } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

export interface UseChoiceSelectionReturn {
  choiceSelections: Record<string, string[]>
  choiceErrors: Record<string, string | null>
  submittingChoiceId: string | null
  setSubmittingChoiceId: (id: string | null) => void
  toggleChoice: (blockKey: string, optionId: string, isMultiSelect: boolean, maxSelections: number) => void
  clearChoiceError: (blockKey: string) => void
  setChoiceError: (blockKey: string, error: string) => void
  resetChoiceSelections: () => void
}

export function useChoiceSelection(): UseChoiceSelectionReturn {
  const { t } = useLanguage()
  const [choiceSelections, setChoiceSelections] = useState<Record<string, string[]>>({})
  const [choiceErrors, setChoiceErrors] = useState<Record<string, string | null>>({})
  const [submittingChoiceId, setSubmittingChoiceId] = useState<string | null>(null)

  const toggleChoice = useCallback((blockKey: string, optionId: string, isMultiSelect: boolean, maxSelections: number) => {
    setChoiceErrors(prev => ({ ...prev, [blockKey]: null }))
    setChoiceSelections(prev => {
      const current = prev[blockKey] || []
      if (!isMultiSelect) return { ...prev, [blockKey]: [optionId] }
      if (current.includes(optionId)) return { ...prev, [blockKey]: current.filter(id => id !== optionId) }
      if (current.length >= maxSelections) {
        const errorKey = maxSelections === 1
          ? "agentChatCore.choice.maxSelectionsErrorSingular"
          : "agentChatCore.choice.maxSelectionsErrorPlural"
        setChoiceErrors(p => ({ ...p, [blockKey]: t(errorKey).replace("{max}", String(maxSelections)) }))
        return prev
      }
      return { ...prev, [blockKey]: [...current, optionId] }
    })
  }, [t])

  const clearChoiceError = useCallback((blockKey: string) => {
    setChoiceErrors(prev => ({ ...prev, [blockKey]: null }))
  }, [])

  const setChoiceError = useCallback((blockKey: string, error: string) => {
    setChoiceErrors(prev => ({ ...prev, [blockKey]: error }))
  }, [])

  const resetChoiceSelections = useCallback(() => {
    setChoiceSelections({})
    setChoiceErrors({})
    setSubmittingChoiceId(null)
  }, [])

  return {
    choiceSelections,
    choiceErrors,
    submittingChoiceId,
    setSubmittingChoiceId,
    toggleChoice,
    clearChoiceError,
    setChoiceError,
    resetChoiceSelections,
  }
}
