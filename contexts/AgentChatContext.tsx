// =========================================================================
// AgentChatContext — WDB adapter for the ported SupportAI agent-chat module.
//
// The shared module's types.ts re-exports `ProcessLogAttachment` from here.
// In SupportAI this context also drives cross-page chat triggering (process-log
// / insight hand-off). WDB does not use process logs, so we only provide the
// type shape the shared types depend on — no provider, no runtime logic.
//
// `ProcessLogAttachment` mirrors SupportAI's definition so the shared
// ChatMessage.processLog field stays type-compatible if ever populated.
// =========================================================================

export interface ProcessLogAttachment {
  id: string
  folder: string
  customer_mail: string
  answer: string
  reasoning: string
  created_at: string
  stimmung?: string | null
  status: string
  processing_time?: number | null
}
