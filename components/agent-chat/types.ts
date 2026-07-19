// =========================================================================
// Shared types for agent chat (single source of truth)
// =========================================================================

import type { ProcessLogAttachment } from "@/contexts/AgentChatContext"

export type AgentFormField = {
  id: string
  label: string
  type: "text" | "textarea" | "select" | "number"
  placeholder?: string
  description?: string
  required?: boolean
  defaultValue?: string
  options?: { value: string; label: string }[]
}

export type AgentRichBlock =
  | { type: "text"; text: string }
  | { type: "code"; title?: string; language?: string; content: string }
  | { type: "table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "image"; title?: string; url: string; alt?: string }
  | { type: "chart"; chartType: "area" | "bar" | "donut" | "kpi"; chartData: any }
  | {
      type: "interactive_choices"
      title?: string
      prompt: string
      selectionMode?: "single" | "multiple" | "either_or"
      options: Array<{ id: string; label: string; description?: string }>
      minSelections?: number
      maxSelections?: number
      submitLabel?: string
      responsePrefix?: string
    }
  | {
      type: "form"
      title?: string
      description?: string
      fields: AgentFormField[]
      submitLabel?: string
      responsePrefix?: string
    }
  | {
      type: "accordion"
      title?: string
      sections: Array<{ id: string; title: string; content: string; defaultOpen?: boolean }>
    }
  | {
      type: "timeline"
      title?: string
      steps: Array<{ id: string; label: string; description?: string; status?: "done" | "active" | "pending" | "error"; timestamp?: string }>
    }
  | {
      type: "confirmation"
      title: string
      description?: string
      confirmLabel?: string
      cancelLabel?: string
      severity?: "info" | "warning" | "danger"
      responsePrefix?: string
      confirmAction?: { tool: string; args: Record<string, any> }
      /** Server-seitig gesetzt sobald die Aktion ausgefuehrt wurde
       * (execute-action markiert den Block im persistierten rich_content).
       * Macht die Entscheidung reload-/refetch-fest — die Buttons duerfen
       * danach nie wieder klickbar erscheinen. */
      decision?: "confirmed" | "cancelled"
      decidedAt?: string
    }
  | {
      type: "status_card"
      title: string
      status: "open" | "in_progress" | "resolved" | "closed" | "escalated"
      /** AI-authored badge text. Falls back to a default label for `status` when absent. */
      statusLabel?: string
      fields: Array<{ label: string; value: string }>
      updatedAt?: string
    }
  | {
      type: "diff"
      title?: string
      language?: string
      before: string
      after: string
    }
  | {
      type: "action_buttons"
      title?: string
      description?: string
      buttons: Array<{ id: string; label: string; variant?: "primary" | "secondary" | "danger"; icon?: string; action?: { tool: string; args: Record<string, any> } }>
      responsePrefix?: string
    }
  | {
      type: "alert"
      severity: "info" | "success" | "warning" | "error"
      title?: string
      message: string
    }
  | {
      type: "tabs"
      title?: string
      tabs: Array<{ id: string; label: string; content: string }>
    }

export type AgentRichContent = {
  blocks?: AgentRichBlock[]
  references?: any[]
}

export type PendingImage = {
  id: string
  file: File
  previewUrl: string
  name: string
}

export type SubToolActivity = {
  id: string
  label: string
  status: "running" | "done" | "error"
  tool?: string
  agent?: string
  error?: string
  details?: { lines?: string[] }
  /** Live-streaming text aus sub_text_delta — vollständig akkumuliert, nicht truncated. */
  streamText?: string
  startedAt?: number
  endedAt?: number
}

export type ToolActivity = {
  id: string
  label: string
  status: "running" | "done" | "error"
  tool?: string
  error?: string
  details?: {
    lines?: string[]
    links?: Array<{ title: string; url: string }>
    request?: string
    response?: string
  }
  subActivities?: SubToolActivity[]
  startedAt?: number
  endedAt?: number
}

export type ChatMessage = {
  id: string
  role: "assistant" | "user"
  content: string
  richContent?: AgentRichContent | null
  toolActivities?: ToolActivity[]
  imageUrls?: string[]
  processLog?: ProcessLogAttachment | null
  /** UI-Trace-Fragmente (Preamble-/Abort-Rows): rendern ja, aber NIE als
   *  History an das Modell schicken (SOTA-Block 1, Review-Finding). */
  excludeFromHistory?: boolean
}

export type ConversationSummary = {
  id: string
  title: string | null
  last_message_preview: string | null
  last_message_at: string | null
}

export type AgentHistoryMessage = {
  role: "assistant" | "user"
  content: string
}

export type AgentApiResponse = {
  message?: string
  richContent?: AgentRichContent
  conversationId?: string | null
  toolActivities?: Array<{
    id?: string
    label?: string
    status?: "running" | "done" | "error"
    tool?: string
    error?: string
    details?: { lines?: string[]; links?: Array<{ title?: string; url?: string }> }
  }>
  error?: string
}

export type QuickAction = {
  id: string
  label: string
  icon: any
  prompt: string
  description?: string
}

// Re-export from context
export type { ProcessLogAttachment } from "@/contexts/AgentChatContext"
