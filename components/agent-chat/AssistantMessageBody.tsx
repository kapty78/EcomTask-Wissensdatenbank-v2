"use client"

import { useMemo } from "react"
import type { ChatMessage } from "./types"
import type { UseTableSelectionReturn } from "./hooks/use-table-selection"
import type { UseChoiceSelectionReturn } from "./hooks/use-choice-selection"
import type { UseFormStateReturn } from "./hooks/use-form-state"
import { stripChartJson, extractJsonBlocks } from "./helpers"
import { MarkdownMessage } from "./blocks/MarkdownMessage"
import { RichBlockRenderer } from "./blocks/RichBlockRenderer"
import { DetailsGroup } from "./blocks/DetailsGroup"
import { AgentTrace } from "./AgentTrace"

/** Bloecke, mit denen der User interagieren MUSS — bleiben sichtbar unter der
 *  Antwort, nie im zugeklappten Details-Dropdown versteckt. */
const INTERACTIVE_BLOCK_TYPES = new Set(["interactive_choices", "form", "confirmation", "action_buttons"])

interface AssistantMessageBodyProps {
  message: ChatMessage
  tableSelection: UseTableSelectionReturn
  choiceSelection: UseChoiceSelectionReturn
  formState: UseFormStateReturn
  isThinking: boolean
  /** Ist DIESE Message die neueste im Chat? Nur dann darf ihr Trace-Header
   * den Live-Spinner zeigen — `isThinking` allein ist global (der ganze Chat
   * ist gerade busy) und wuerde sonst auch abgeschlossene Traces aus
   * frueheren Turns wieder als "laeuft" anzeigen. */
  isLatestMessage?: boolean
  onSubmitMessage: (msg: string) => Promise<void>
  conversationId?: string | null
  getAuthToken?: () => Promise<string | null>
  /** Vom Parent ermittelt: hat eine spaetere User-Message diesen
   * Confirmation-Block schon beantwortet? Wird an alle ConfirmationBlocks
   * in dieser Message durchgereicht — verhindert dass die Buttons bei
   * Reload erneut klickbar erscheinen. */
  confirmationDecided?: "confirmed" | "cancelled" | null
  /** Vom Parent ermittelt: der plan_execute-Lauf dieser Message hat eine
   * fertige Assistant-Antwort produziert — loest den Confirmation-Spinner auf. */
  planRunFinished?: boolean
}

export function AssistantMessageBody({
  message,
  tableSelection,
  choiceSelection,
  formState,
  isThinking,
  isLatestMessage = false,
  onSubmitMessage,
  conversationId,
  getAuthToken,
  confirmationDecided,
  planRunFinished,
}: AssistantMessageBodyProps) {
  // Memoize the heavy text parsing (O(n²) JSON balance scan + chart-json strip)
  // so we don't re-run it on every parent re-render — critical during streaming
  // where the parent re-renders per token but only the active message changes.
  // Hook must run before any early return (Rules of Hooks).
  const rawContent = message.content ?? ""
  const parsed = useMemo(() => {
    const cleaned = stripChartJson(rawContent)
    const { blocks: extractedBlocks, remainingText } = extractJsonBlocks(cleaned)
    return { cleaned, extractedBlocks, remainingText }
  }, [rawContent])

  const toolActivities = Array.isArray(message.toolActivities) ? message.toolActivities : []
  const hasToolActivities = toolActivities.length > 0
  // Trace ist "streaming" (= Header-Spinner + "Agent arbeitet" + 250ms-Tick)
  // wenn entweder lokal gerade gestreamt wird ODER irgendeine Activity noch
  // running ist (gilt insbesondere fuer den Live-Resume-Polling-Fall, wo
  // isThinking=false ist aber tool_status='running' aus der DB kommt).
  const anyRunning = hasToolActivities && toolActivities.some(a => a.status === "running" || a.subActivities?.some(s => s.status === "running"))
  const traceIsStreaming = (isThinking && isLatestMessage && hasToolActivities) || anyRunning

  // Tool-activity-only messages: render the trace, no body fallback needed
  if (hasToolActivities && !message.content?.trim() && !message.richContent?.blocks?.length) {
    return <AgentTrace activities={toolActivities} isStreaming={traceIsStreaming} />
  }

  const richContent = message.richContent
  const blocks = Array.isArray(richContent?.blocks) ? richContent!.blocks : []

  // If there are chart blocks, filter out JSON code blocks (chart data the agent accidentally included)
  const hasCharts = blocks.some(b => b.type === "chart")
  const filteredBlocks = hasCharts
    ? blocks.filter(b => {
        if (b.type === "code" && b.language === "json") return false
        return true
      })
    : blocks

  if (filteredBlocks.length === 0 && !hasCharts) {
    const { cleaned, extractedBlocks, remainingText } = parsed
    if (extractedBlocks.length > 0) {
      return (
        <div className="space-y-2.5">
          {hasToolActivities && <AgentTrace activities={toolActivities} isStreaming={traceIsStreaming} />}
          {remainingText && <MarkdownMessage content={remainingText} />}
          {extractedBlocks.map((block, index) => (
            <RichBlockRenderer
              key={`extracted-${index}`}
              block={block}
              blockIndex={index}
              messageId={message.id}
              tableSelection={tableSelection}
              choiceSelection={choiceSelection}
              formState={formState}
              isThinking={isThinking}
              onSubmitMessage={onSubmitMessage}
              conversationId={conversationId}
              getAuthToken={getAuthToken}
              confirmationDecided={confirmationDecided}
              planRunFinished={planRunFinished}
            />
          ))}
        </div>
      )
    }

    if (hasToolActivities) {
      return (
        <div className="space-y-2.5">
          <AgentTrace activities={toolActivities} isStreaming={traceIsStreaming} />
          <MarkdownMessage content={cleaned} />
        </div>
      )
    }
    return <MarkdownMessage content={cleaned} />
  }

  // For text blocks: strip any embedded JSON chart data
  const processedBlocks = filteredBlocks.map(b => {
    if (b.type === "text" && hasCharts) {
      return { ...b, text: stripChartJson(b.text) }
    }
    return b
  }).filter(b => b.type !== "text" || (b as any).text?.trim())

  // Partition (User-Feedback 2026-07-08): Auswertungs-Bloecke (Eval-Protokolle,
  // Empfehlungen, Daten-Tabellen …) wandern in EIN uebergeordnetes Dropdown
  // ZWISCHEN Trace und Antwort-Text. Text bleibt der Star; interaktive
  // Bloecke (Choices/Forms/Confirmations/Buttons) bleiben sichtbar darunter.
  // blockIndex bleibt der Index in processedBlocks — Tabellen-State
  // (messageId:blockIndex) haengt daran und muss stabil bleiben.
  const indexedBlocks = processedBlocks.map((block, index) => ({ block, index }))
  const textEntries = indexedBlocks.filter((e) => e.block.type === "text")
  const interactiveEntries = indexedBlocks.filter((e) => INTERACTIVE_BLOCK_TYPES.has(e.block.type))
  const detailEntries = indexedBlocks.filter(
    (e) => e.block.type !== "text" && !INTERACTIVE_BLOCK_TYPES.has(e.block.type)
  )
  // Besteht die Antwort NUR aus Detail-Bloecken (kein Text, nichts
  // Interaktives), waere ein zugeklapptes Dropdown eine leere Antwort —
  // dann default offen.
  const detailsDefaultOpen = textEntries.length === 0 && interactiveEntries.length === 0

  const renderEntry = ({ block, index }: { block: (typeof processedBlocks)[number]; index: number }) => (
    <RichBlockRenderer
      key={`block-${index}`}
      block={block}
      blockIndex={index}
      messageId={message.id}
      tableSelection={tableSelection}
      choiceSelection={choiceSelection}
      formState={formState}
      isThinking={isThinking}
      onSubmitMessage={onSubmitMessage}
      conversationId={conversationId}
      getAuthToken={getAuthToken}
      confirmationDecided={confirmationDecided}
      planRunFinished={planRunFinished}
    />
  )

  return (
    <div className="space-y-2.5">
      {hasToolActivities && <AgentTrace activities={toolActivities} isStreaming={traceIsStreaming} />}
      {detailEntries.length > 0 && (
        <DetailsGroup count={detailEntries.length} defaultOpen={detailsDefaultOpen}>
          {detailEntries.map(renderEntry)}
        </DetailsGroup>
      )}
      {textEntries.map(renderEntry)}
      {interactiveEntries.map(renderEntry)}
    </div>
  )
}
