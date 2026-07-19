"use client"

import type { AgentRichBlock } from "../types"
import type { UseTableSelectionReturn } from "../hooks/use-table-selection"
import type { UseChoiceSelectionReturn } from "../hooks/use-choice-selection"
import type { UseFormStateReturn } from "../hooks/use-form-state"
import { MarkdownMessage } from "./MarkdownMessage"
import { CodeBlock } from "./CodeBlock"
import { ImageBlock } from "./ImageBlock"
import { ChartBlock } from "./ChartBlock"
import { InteractiveTable } from "./InteractiveTable"
import { InteractiveChoices } from "./InteractiveChoices"
import { FormBlock } from "./FormBlock"
import { AccordionBlock } from "./AccordionBlock"
import { TimelineBlock } from "./TimelineBlock"
import { ConfirmationBlock } from "./ConfirmationBlock"
import { StatusCardBlock } from "./StatusCardBlock"
import { DiffViewerBlock } from "./DiffViewerBlock"
import { ActionButtonsBlock } from "./ActionButtonsBlock"
import { AlertBlock } from "./AlertBlock"
import { TabsBlock } from "./TabsBlock"

interface RichBlockRendererProps {
  block: AgentRichBlock
  blockIndex: number
  messageId: string
  tableSelection: UseTableSelectionReturn
  choiceSelection: UseChoiceSelectionReturn
  formState: UseFormStateReturn
  isThinking: boolean
  onSubmitMessage: (msg: string) => Promise<void>
  conversationId?: string | null
  getAuthToken?: () => Promise<string | null>
  /** Bereits-getroffene Confirmation-Entscheidung — vom Parent aus den
   * folgenden User-Messages abgeleitet. Wird an ConfirmationBlock durchgereicht. */
  confirmationDecided?: "confirmed" | "cancelled" | null
  /** Der plan_execute-Lauf dieses Blocks hat eine fertige Assistant-Antwort
   * produziert — loest den "wird ausgefuehrt…"-Spinner im ConfirmationBlock auf. */
  planRunFinished?: boolean
}

export function RichBlockRenderer({
  block,
  blockIndex,
  messageId,
  tableSelection,
  choiceSelection,
  formState,
  isThinking,
  onSubmitMessage,
  conversationId,
  getAuthToken,
  confirmationDecided,
  planRunFinished,
}: RichBlockRendererProps) {
  if (block.type === "text") {
    return <div key={`text-${blockIndex}`}><MarkdownMessage content={block.text} /></div>
  }
  if (block.type === "code") {
    return <CodeBlock block={block} blockIndex={blockIndex} />
  }
  if (block.type === "table") {
    return <InteractiveTable block={block} blockIndex={blockIndex} messageId={messageId} tableSelection={tableSelection} />
  }
  if (block.type === "image") {
    return <ImageBlock block={block} blockIndex={blockIndex} />
  }
  if (block.type === "chart") {
    return <ChartBlock block={block} blockIndex={blockIndex} />
  }
  if (block.type === "interactive_choices") {
    return <InteractiveChoices block={block} blockIndex={blockIndex} messageId={messageId} choiceSelection={choiceSelection} isThinking={isThinking} onSubmitMessage={onSubmitMessage} />
  }
  if (block.type === "form") {
    return <FormBlock block={block} blockIndex={blockIndex} messageId={messageId} formState={formState} isThinking={isThinking} onSubmitMessage={onSubmitMessage} />
  }
  if (block.type === "accordion") {
    return <AccordionBlock block={block} blockIndex={blockIndex} />
  }
  if (block.type === "timeline") {
    return <TimelineBlock block={block} blockIndex={blockIndex} />
  }
  if (block.type === "confirmation") {
    return <ConfirmationBlock block={block} blockIndex={blockIndex} isThinking={isThinking} onSubmitMessage={onSubmitMessage} conversationId={conversationId} getAuthToken={getAuthToken} alreadyDecided={confirmationDecided} planRunFinished={planRunFinished} />
  }
  if (block.type === "status_card") {
    return <StatusCardBlock block={block} blockIndex={blockIndex} />
  }
  if (block.type === "diff") {
    return <DiffViewerBlock block={block} blockIndex={blockIndex} />
  }
  if (block.type === "action_buttons") {
    return <ActionButtonsBlock block={block} blockIndex={blockIndex} isThinking={isThinking} onSubmitMessage={onSubmitMessage} conversationId={conversationId} getAuthToken={getAuthToken} />
  }
  if (block.type === "alert") {
    return <AlertBlock block={block} blockIndex={blockIndex} />
  }
  if (block.type === "tabs") {
    return <TabsBlock block={block} blockIndex={blockIndex} />
  }
  return null
}
