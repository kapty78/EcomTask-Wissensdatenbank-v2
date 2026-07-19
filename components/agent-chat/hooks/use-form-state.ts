"use client"

import { useState, useCallback } from "react"
import type { AgentFormField } from "../types"
import { useLanguage } from "@/contexts/LanguageContext"

export interface UseFormStateReturn {
  formValues: Record<string, Record<string, string>>
  formErrors: Record<string, string | null>
  submittingFormId: string | null
  setSubmittingFormId: (id: string | null) => void
  updateField: (formKey: string, fieldId: string, value: string) => void
  validateAndBuildSubmission: (formKey: string, fields: AgentFormField[], responsePrefix: string) => string | null
  clearFormError: (formKey: string) => void
  resetFormState: () => void
}

export function useFormState(): UseFormStateReturn {
  const { t } = useLanguage()
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({})
  const [submittingFormId, setSubmittingFormId] = useState<string | null>(null)

  const updateField = useCallback((formKey: string, fieldId: string, value: string) => {
    setFormErrors(prev => ({ ...prev, [formKey]: null }))
    setFormValues(prev => ({ ...prev, [formKey]: { ...(prev[formKey] || {}), [fieldId]: value } }))
  }, [])

  const validateAndBuildSubmission = useCallback((formKey: string, fields: AgentFormField[], responsePrefix: string): string | null => {
    const currentValues = formValues[formKey] || {}
    const missing = fields.filter(f => f.required && !(currentValues[f.id] || "").trim())
    if (missing.length > 0) {
      setFormErrors(p => ({ ...p, [formKey]: t("agentChatCore.form.missingFieldsError").replace("{fields}", missing.map(f => f.label).join(", ")) }))
      return null
    }
    const entries = fields
      .map(f => {
        const val = (currentValues[f.id] || f.defaultValue || "").trim()
        return val ? `${f.label}: ${val}` : null
      })
      .filter(Boolean)
    return `${responsePrefix}:\n${entries.join("\n")}`
  }, [formValues, t])

  const clearFormError = useCallback((formKey: string) => {
    setFormErrors(prev => ({ ...prev, [formKey]: null }))
  }, [])

  const resetFormState = useCallback(() => {
    setFormValues({})
    setFormErrors({})
    setSubmittingFormId(null)
  }, [])

  return {
    formValues,
    formErrors,
    submittingFormId,
    setSubmittingFormId,
    updateField,
    validateAndBuildSubmission,
    clearFormError,
    resetFormState,
  }
}
