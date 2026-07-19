"use client"

import { ArrowDown, Loader2 } from "lucide-react"
import type { AgentRichBlock } from "../types"
import type { UseFormStateReturn } from "../hooks/use-form-state"
import { MarkdownMessage } from "./MarkdownMessage"
import { useLanguage } from "@/contexts/LanguageContext"

type FormBlockData = AgentRichBlock & { type: "form" }

interface FormBlockProps {
  block: FormBlockData
  blockIndex: number
  messageId: string
  formState: UseFormStateReturn
  isThinking: boolean
  onSubmitMessage: (msg: string) => Promise<void>
}

export function FormBlock({ block, blockIndex, messageId, formState, isThinking, onSubmitMessage }: FormBlockProps) {
  const { t } = useLanguage()
  const { formValues, formErrors, submittingFormId, setSubmittingFormId, updateField, validateAndBuildSubmission } = formState
  const formKey = `${messageId}:${blockIndex}`
  const fields = Array.isArray(block.fields) ? block.fields.filter(f => !!f?.id && !!f?.label).slice(0, 20) : []
  if (fields.length === 0) return null

  const currentValues = formValues[formKey] || {}
  const formError = formErrors[formKey] || null
  const isSubmitting = submittingFormId === formKey
  const submitDisabled = isThinking || isSubmitting
  const submitLabel = block.submitLabel || t('agentChatBlocks.form.submitDefaultLabel')

  const handleSubmit = async () => {
    if (isThinking || isSubmitting) return
    const responsePrefix = (block.responsePrefix || t('agentChatBlocks.form.defaultPrefix')).trim()
    const submission = validateAndBuildSubmission(formKey, fields, responsePrefix)
    if (!submission) return
    setSubmittingFormId(formKey)
    try { await onSubmitMessage(submission) } finally { setSubmittingFormId(null) }
  }

  return (
    <div key={`form-${formKey}`} className="rounded-lg border border-border bg-card p-3 space-y-2.5">
      {block.title && <div className="text-[11px] font-medium text-foreground">{block.title}</div>}
      {block.description && <div className="text-[10.5px] leading-relaxed text-muted-foreground"><MarkdownMessage content={block.description} /></div>}
      <div className="space-y-2">
        {fields.map(field => {
          const value = currentValues[field.id] ?? field.defaultValue ?? ""
          return (
            <div key={`${formKey}-${field.id}`} className="space-y-1">
              <label className="block text-[11px] font-medium text-foreground">
                {field.label}{field.required && <span className="text-[#f381cf] ml-0.5">*</span>}
              </label>
              {field.description && <div className="text-[10px] text-muted-foreground">{field.description}</div>}
              {field.type === "textarea" ? (
                <textarea
                  value={value}
                  onChange={e => updateField(formKey, field.id, e.target.value)}
                  placeholder={field.placeholder || ""}
                  rows={3}
                  className="w-full rounded-md border border-border bg-white/[0.02] px-2.5 py-1.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/50 focus:border-[#f381cf]/40 focus:outline-none focus:ring-1 focus:ring-[#f381cf]/20 resize-y min-h-[60px]"
                />
              ) : field.type === "select" && Array.isArray(field.options) ? (
                <select
                  value={value}
                  onChange={e => updateField(formKey, field.id, e.target.value)}
                  className="w-full rounded-md border border-border bg-white/[0.02] px-2.5 py-1.5 text-[11.5px] text-foreground focus:border-[#f381cf]/40 focus:outline-none focus:ring-1 focus:ring-[#f381cf]/20 appearance-none"
                >
                  <option value="">{field.placeholder || t('agentChatBlocks.form.selectPlaceholder')}</option>
                  {field.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === "number" ? "number" : "text"}
                  value={value}
                  onChange={e => updateField(formKey, field.id, e.target.value)}
                  placeholder={field.placeholder || ""}
                  className="w-full rounded-md border border-border bg-white/[0.02] px-2.5 py-1.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/50 focus:border-[#f381cf]/40 focus:outline-none focus:ring-1 focus:ring-[#f381cf]/20"
                />
              )}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="text-[10.5px] text-muted-foreground">
          {fields.filter(f => f.required).length > 0
            ? t(fields.filter(f => f.required).length === 1 ? 'agentChatBlocks.form.requiredFieldsSingular' : 'agentChatBlocks.form.requiredFieldsPlural').replace('{count}', String(fields.filter(f => f.required).length))
            : t('agentChatBlocks.form.allFieldsOptional')}
        </div>
        <button type="button" onClick={handleSubmit} disabled={submitDisabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-foreground transition-colors hover:border-white/30 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">
          {isSubmitting ? <Loader2 className="size-3 animate-spin" /> : <ArrowDown className="size-3" />}
          <span>{submitLabel}</span>
        </button>
      </div>
      {formError && <div className="text-[10.5px] text-[#f381cf]/80">{formError}</div>}
    </div>
  )
}
