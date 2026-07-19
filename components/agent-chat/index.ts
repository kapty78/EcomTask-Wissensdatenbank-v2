// =========================================================================
// Agent Chat shared module - barrel export
// =========================================================================

// Types
export type {
  AgentFormField,
  AgentRichBlock,
  AgentRichContent,
  PendingImage,
  SubToolActivity,
  ToolActivity,
  ChatMessage,
  ConversationSummary,
  AgentHistoryMessage,
  AgentApiResponse,
  QuickAction,
} from "./types"
export type { ProcessLogAttachment } from "./types"

// Helpers
export {
  compact,
  sleep,
  splitCodeBlocks,
  normalizeRichContent,
  preprocessMarkdown,
  stripChartJson,
  expandSlashCommand,
} from "./helpers"

// Hooks
export { useTableSelection } from "./hooks/use-table-selection"
export type { UseTableSelectionReturn } from "./hooks/use-table-selection"
export { useChoiceSelection } from "./hooks/use-choice-selection"
export type { UseChoiceSelectionReturn } from "./hooks/use-choice-selection"
export { useFormState } from "./hooks/use-form-state"
export type { UseFormStateReturn } from "./hooks/use-form-state"

// Block components
export { MarkdownMessage } from "./blocks/MarkdownMessage"
export { CodeBlock } from "./blocks/CodeBlock"
export { ImageBlock } from "./blocks/ImageBlock"
export { ChartBlock } from "./blocks/ChartBlock"
export { InteractiveTable } from "./blocks/InteractiveTable"
export { InteractiveChoices } from "./blocks/InteractiveChoices"
export { FormBlock } from "./blocks/FormBlock"
export { RichBlockRenderer } from "./blocks/RichBlockRenderer"

// New block components (Phase 3)
export { AccordionBlock } from "./blocks/AccordionBlock"
export { TimelineBlock } from "./blocks/TimelineBlock"
export { ConfirmationBlock } from "./blocks/ConfirmationBlock"
export { StatusCardBlock } from "./blocks/StatusCardBlock"
export { DiffViewerBlock } from "./blocks/DiffViewerBlock"
export { ActionButtonsBlock } from "./blocks/ActionButtonsBlock"
export { AlertBlock } from "./blocks/AlertBlock"
export { TabsBlock } from "./blocks/TabsBlock"

// Composed components
export { AssistantMessageBody } from "./AssistantMessageBody"
