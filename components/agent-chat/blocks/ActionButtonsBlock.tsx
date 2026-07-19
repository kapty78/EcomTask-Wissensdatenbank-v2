"use client"

import { useState } from "react"
import { Check, Loader2 } from "lucide-react"
import type { AgentRichBlock } from "../types"
import { MarkdownMessage } from "./MarkdownMessage"
import { useLanguage } from "@/contexts/LanguageContext"

type ActionButtonsBlockData = AgentRichBlock & { type: "action_buttons" }

const VARIANT_STYLES = {
  primary: "bg-[#f381cf] hover:bg-[#d96db5] text-white border-transparent",
  secondary: "bg-white/[0.04] hover:bg-white/[0.08] text-foreground/80 border-white/10",
  danger: "bg-red-50 hover:bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:hover:bg-red-500/20 dark:text-red-400 dark:border-red-500/20",
}

interface ActionButtonsBlockProps {
  block: ActionButtonsBlockData
  blockIndex: number
  isThinking: boolean
  onSubmitMessage: (msg: string) => Promise<void>
  conversationId?: string | null
  getAuthToken?: () => Promise<string | null>
}

export function ActionButtonsBlock({ block, blockIndex, isThinking, onSubmitMessage, conversationId, getAuthToken }: ActionButtonsBlockProps) {
  const buttons = Array.isArray(block.buttons) ? block.buttons.filter(b => !!b?.id && !!b?.label).slice(0, 6) : []
  if (buttons.length === 0) return null

  const { t } = useLanguage()
  const [clickedId, setClickedId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionResult, setActionResult] = useState<string | null>(null)
  const responsePrefix = (block.responsePrefix || t('agentChatBlocks.common.actionLabel')).trim()

  const executeDirectAction = async (action: { tool: string; args: Record<string, any> }) => {
    const token = getAuthToken ? await getAuthToken() : null
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (token) headers["Authorization"] = `Bearer ${token}`

    const res = await fetch("/api/support-agent/execute-action", {
      method: "POST",
      headers,
      body: JSON.stringify({ tool: action.tool, args: action.args, conversationId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || t('agentChatBlocks.common.executionFailed'))
    return data.result
  }

  const handleClick = async (button: (typeof buttons)[0]) => {
    if (isThinking || isSubmitting || clickedId) return
    setClickedId(button.id)
    setIsSubmitting(true)
    try {
      if (button.action?.tool) {
        // Direct tool execution — no new AI round needed
        const result = await executeDirectAction(button.action)
        const resultText =
          typeof result?.agent_response === "string" ? result.agent_response
          : typeof result?.message === "string" ? result.message
          : result?.ok === true ? t('agentChatBlocks.common.actionSucceeded')
          : result?.ok === false ? `${t('agentChatCore.trace.errorLabel')} ${result?.error?.message || `${t('agentChatBlocks.common.executionFailed')}.`}`
          : t('agentChatBlocks.common.actionExecuted')
        setActionResult(resultText)
      } else {
        // Fallback: send as user message
        await onSubmitMessage(`${responsePrefix}: ${button.label}`)
      }
    } catch (err: any) {
      setActionResult(`${t('agentChatCore.trace.errorLabel')} ${err?.message || t('agentChatBlocks.common.unknownError')}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div key={`actions-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-3">
      {block.title && <div className="text-[13px] font-medium text-foreground/80">{block.title}</div>}
      {block.description && (
        <div className="text-[12px] leading-relaxed text-foreground/60">
          <MarkdownMessage content={block.description} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {buttons.map(button => {
          const variant = button.variant || "secondary"
          const style = VARIANT_STYLES[variant] || VARIANT_STYLES.secondary
          const isClicked = clickedId === button.id
          const isDisabled = isThinking || isSubmitting || (clickedId !== null && clickedId !== button.id)

          return (
            <button
              key={button.id}
              type="button"
              onClick={() => handleClick(button)}
              disabled={isDisabled}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                isClicked && !isSubmitting ? "ring-1 ring-[#f381cf]/40 " + style : style
              }`}
            >
              {isClicked && isSubmitting && <Loader2 className="size-3 animate-spin" />}
              {isClicked && !isSubmitting && actionResult && <Check className="size-3 text-[#f381cf]" />}
              {button.label}
            </button>
          )
        })}
      </div>
      {actionResult && !isSubmitting && (
        <div className="text-[11.5px] leading-relaxed text-foreground/60 border-t border-white/[0.06] pt-2 mt-1">
          <MarkdownMessage content={actionResult} />
        </div>
      )}
    </div>
  )
}
