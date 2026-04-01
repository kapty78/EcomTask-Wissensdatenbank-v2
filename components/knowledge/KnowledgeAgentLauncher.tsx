"use client"

import { getSupabaseClient } from "@/lib/supabase-browser"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertCircle, ArrowDown, Check, ChevronDown, FileText, Globe, History, Image as ImageIcon, Link2, Loader2, MoreHorizontal, MoreVertical, Paperclip, Pencil, Plus, Search, Sparkles, Trash2, Wrench, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { playClick, playError, playSuccess, playWarning, playWorking } from "@/lib/sounds"

const KB_EVENT_NAME = "knowledge-base:changed"
const AGENT_REFERENCE_EVENT = "knowledge-agent:open-reference"
const KB_STORAGE_KEY = "active_knowledge_base_id"
const CLOSE_ANIMATION_MS = 240

type AgentRichBlock =
  | {
      type: "text"
      text: string
    }
  | {
      type: "code"
      title?: string
      language?: string
      content: string
    }
  | {
      type: "table"
      title?: string
      columns: string[]
      rows: string[][]
    }
  | {
      type: "image"
      title?: string
      url: string
      alt?: string
    }
  | {
      type: "interactive_choices"
      title?: string
      prompt: string
      selectionMode?: "single" | "multiple" | "either_or"
      options: Array<{
        id: string
        label: string
        description?: string
      }>
      minSelections?: number
      maxSelections?: number
      submitLabel?: string
      responsePrefix?: string
    }

type AgentRichReference = {
  type: "knowledge_base" | "document" | "chunk" | "fact"
  id: string
  label: string
  checkProcessing?: boolean
  knowledgeBaseId?: string | null
  documentId?: string | null
  chunkId?: string | null
  factId?: string | null
  sourceName?: string | null
}

type AgentRichContent = {
  blocks?: AgentRichBlock[]
  references?: AgentRichReference[]
}

type PendingAttachment = {
  id: string
  file: File
  previewUrl: string | null
  name: string
  type: string
  size: number
}

type AgentAttachment = {
  url: string
  name: string
  type: string
  size: number
}

type ChatMessage = {
  id: string
  role: "assistant" | "user"
  content: string
  richContent?: AgentRichContent | null
  toolActivities?: ToolActivity[]
  attachments?: AgentAttachment[]
}

type ToolActivity = {
  id: string
  label: string
  status: "running" | "done" | "error"
  tool?: string
  error?: string
  details?: {
    lines?: string[]
    links?: Array<{ title: string; url: string }>
  }
}

type ConversationSummary = {
  id: string
  title: string | null
  last_message_preview: string | null
  last_message_at: string | null
  knowledge_base_id: string | null
}

type AgentHistoryMessage = {
  role: "assistant" | "user"
  content: string
}

type AgentApiResponse = {
  message?: string
  richContent?: AgentRichContent
  activeKnowledgeBaseId?: string | null
  conversationId?: string | null
  toolActivities?: Array<{
    id?: string
    label?: string
    status?: "running" | "done" | "error"
    tool?: string
    error?: string
    details?: {
      lines?: string[]
      links?: Array<{ title?: string; url?: string }>
    }
  }>
  error?: string
}

interface KnowledgeAgentLauncherProps {
  userName?: string
  /** "inline" = input bar in header (default), "floating" = mobile FAB in corner */
  variant?: "inline" | "floating"
}

type QuickAction = {
  id: string
  label: string
  icon: any
  prompt: string
}

type DocumentReferenceState = {
  phase: "loading" | "processing" | "completed" | "failed" | "unknown"
  statusRaw: string | null
  progress: number
  message?: string | null
  error?: string | null
  updatedAt?: string | null
}

type KnowledgeBaseOption = {
  id: string
  name: string
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function compact(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function normalizeProgress(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(100, Math.round(value)))
}

function mapDocumentPhase(statusRaw: string | null): DocumentReferenceState["phase"] {
  if (!statusRaw) return "unknown"
  if (statusRaw === "completed" || statusRaw === "facts_completed") return "completed"
  if (statusRaw === "failed" || statusRaw === "facts_failed") return "failed"
  if (["uploading", "processing", "embedding", "facts_extracting", "facts_saving"].includes(statusRaw)) {
    return "processing"
  }
  return "unknown"
}

const markdownTableComponents = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 rounded-xl border border-white/[0.06] bg-[#0d0d0f]/80 overflow-hidden shadow-sm [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <Table>{children}</Table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }: { children?: React.ReactNode }) => <TableBody>{children}</TableBody>,
  tr: ({ children }: { children?: React.ReactNode }) => <TableRow className="border-white/[0.04]">{children}</TableRow>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <TableHead className="text-[12px] font-semibold text-white/50">{children}</TableHead>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <TableCell className="text-[12px] text-white/70 py-2">{children}</TableCell>
  )
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none text-[13px] leading-[1.7] prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-2.5 prose-pre:rounded-md prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-code:text-white/70 prose-strong:text-white/85 prose-strong:font-semibold text-white/75">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function splitCodeBlocks(text: string): AgentRichBlock[] {
  const raw = String(text || "")
  if (!raw.includes("```")) {
    const trimmed = raw.trim()
    return trimmed ? [{ type: "text", text: trimmed }] : []
  }

  const blocks: AgentRichBlock[] = []
  const regex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g
  let cursor = 0
  let match: RegExpExecArray | null = null

  while ((match = regex.exec(raw)) !== null) {
    const before = raw.slice(cursor, match.index).trim()
    if (before) {
      blocks.push({ type: "text", text: before })
    }
    const language = match[1] ? String(match[1]).trim() : undefined
    const content = String(match[2] || "").trim()
    if (content) {
      blocks.push({
        type: "code",
        language,
        content
      })
    }
    cursor = match.index + match[0].length
  }

  const tail = raw.slice(cursor).trim()
  if (tail) {
    blocks.push({ type: "text", text: tail })
  }

  return blocks
}

function normalizeRichContent(payload: AgentRichContent | undefined, fallbackText: string): AgentRichContent | null {
  const payloadBlocks = Array.isArray(payload?.blocks) ? payload.blocks : []
  const payloadReferences = Array.isArray(payload?.references) ? payload.references : []
  const hasProvidedBlocks = payloadBlocks.length > 0
  const hasProvidedReferences = payloadReferences.length > 0
  const providedBlocks = payloadBlocks.filter(block => !!block && typeof block === "object")
  const providedReferences = payloadReferences.filter(ref => !!ref?.id && !!ref?.type)

  if (!hasProvidedBlocks && !hasProvidedReferences) {
    if (!String(fallbackText || "").includes("```")) {
      return null
    }
  }

  const fallbackBlocks = splitCodeBlocks(fallbackText)
  const blocks = providedBlocks.length > 0 ? providedBlocks : fallbackBlocks

  if (blocks.length === 0 && providedReferences.length === 0) {
    return null
  }

  return {
    blocks,
    references: providedReferences.slice(0, 30)
  }
}

function syncKnowledgeBaseSelection(nextKbId: string | null) {
  if (typeof window === "undefined") return

  if (nextKbId) {
    window.localStorage.setItem(KB_STORAGE_KEY, nextKbId)
  } else {
    window.localStorage.removeItem(KB_STORAGE_KEY)
  }

  window.dispatchEvent(
    new CustomEvent(KB_EVENT_NAME, { detail: { id: nextKbId } })
  )
}

function emitReferenceSelection(reference: AgentRichReference) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(AGENT_REFERENCE_EVENT, {
      detail: reference
    })
  )
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "search-kb",
    label: "KB durchsuchen",
    icon: Search,
    prompt: "Suche in der aktiven Wissensdatenbank nach: "
  },
  {
    id: "list-docs",
    label: "Dokumente anzeigen",
    icon: FileText,
    prompt: "Zeig mir alle Dokumente der aktiven Wissensdatenbank."
  },
  {
    id: "import-url",
    label: "URL importieren",
    icon: Link2,
    prompt: "Importiere diese URL als Dokument in die aktive Wissensdatenbank: "
  },
  {
    id: "chunk-analysis",
    label: "Chunk analysieren",
    icon: Sparkles,
    prompt: "Analysiere den relevantesten Chunk zum Thema: "
  },
  {
    id: "mismatch-analysis",
    label: "Mismatch prüfen",
    icon: Wrench,
    prompt: "Starte den Mismatch Finder für die aktive Wissensdatenbank und zeige mir widersprüchliche/veraltete Fakten."
  },
  {
    id: "combine-suggestions",
    label: "Combine-Vorschläge",
    icon: Plus,
    prompt: "Zeige mir Chunk-Combine-Vorschläge für die aktive Wissensdatenbank."
  },
  {
    id: "web-reference",
    label: "Web-Referenz",
    icon: Globe,
    prompt: "Prüfe, ob folgende Web-Quelle als Wissensquelle sinnvoll ist: "
  }
]

const AGENT_PREVIEW_TEXT = "Frage eingeben und senden..."

function expandSlashCommand(raw: string): string {
  const value = compact(raw)
  if (!value.startsWith("/")) return value

  const [command, ...rest] = value.split(" ")
  const args = rest.join(" ").trim()

  switch (command.toLowerCase()) {
    case "/suche":
      return args ? `Suche in der aktiven Wissensdatenbank nach: ${args}` : "Suche in der aktiven Wissensdatenbank nach: "
    case "/docs":
      return "Zeig mir die Dokumente der aktiven Wissensdatenbank."
    case "/kb":
      return "Zeig mir alle Wissensdatenbanken und setze bei Bedarf die passende aktiv."
    case "/url":
      return args
        ? `Importiere diese URL als Dokument in die aktive Wissensdatenbank: ${args}`
        : "Importiere diese URL als Dokument in die aktive Wissensdatenbank: "
    case "/chunk":
      return args ? `Erstelle oder ergänze einen Chunk mit Fokus auf: ${args}` : "Erstelle oder ergänze einen Chunk mit Fokus auf: "
    case "/fakt":
      return args ? `Erstelle einen neuen Fakt zum Thema: ${args}` : "Erstelle einen neuen Fakt zum Thema: "
    case "/mismatch":
      return "Starte den Mismatch Finder in der aktiven Wissensdatenbank und zeige Konfliktgruppen."
    case "/combine":
      return "Lade Combine-Vorschläge in der aktiven Wissensdatenbank und zeige die besten Merge-Optionen."
    default:
      return value
  }
}

export default function KnowledgeAgentLauncher({ userName, variant = "inline" }: KnowledgeAgentLauncherProps) {
  const supabase = getSupabaseClient()

  const [isMounted, setIsMounted] = useState(false)
  const [isRendered, setIsRendered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingMessageText, setEditingMessageText] = useState("")
  const [isRegeneratingFromEdit, setIsRegeneratingFromEdit] = useState(false)
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({})
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [knowledgeBaseOptions, setKnowledgeBaseOptions] = useState<KnowledgeBaseOption[]>([])
  const [isKbPickerOpen, setIsKbPickerOpen] = useState(false)
  const [recentConversations, setRecentConversations] = useState<ConversationSummary[]>([])
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [documentReferenceStates, setDocumentReferenceStates] = useState<Record<string, DocumentReferenceState>>({})
  const [choiceSelections, setChoiceSelections] = useState<Record<string, string[]>>({})
  const [choiceErrors, setChoiceErrors] = useState<Record<string, string | null>>({})
  const [submittingChoiceId, setSubmittingChoiceId] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const closeTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const floatingBtnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const supabaseRef = useRef(supabase)
  const documentReferenceStatesRef = useRef<Record<string, DocumentReferenceState>>({})
  const documentStatusPollersRef = useRef<Record<string, number>>({})
  const documentStatusInFlightRef = useRef<Record<string, boolean>>({})
  supabaseRef.current = supabase
  documentReferenceStatesRef.current = documentReferenceStates

  const resolvedName = useMemo(() => {
    const trimmed = userName?.trim()
    return trimmed && trimmed.length > 0 ? trimmed : "du"
  }, [userName])
  const renderedMessages = useMemo(() => [...messages].reverse(), [messages])
  const activeKnowledgeBaseName = useMemo(() => {
    if (!knowledgeBaseId) return "KB wählen"
    return knowledgeBaseOptions.find(option => option.id === knowledgeBaseId)?.name || "KB wählen"
  }, [knowledgeBaseId, knowledgeBaseOptions])
  const referencedDocumentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const message of messages) {
      const refs = Array.isArray(message.richContent?.references) ? message.richContent?.references : []
      for (const reference of refs || []) {
        if (reference?.type !== "document") continue
        if (reference?.checkProcessing !== true) continue
        const docId = String(reference.documentId || reference.id || "").trim()
        if (!docId) continue
        ids.add(docId)
      }
    }
    return Array.from(ids)
  }, [messages])

  useEffect(() => {
    setIsMounted(true)
    if (typeof window === "undefined") return
    setKnowledgeBaseId(window.localStorage.getItem(KB_STORAGE_KEY))

    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ id?: string | null }>
      setKnowledgeBaseId(custom.detail?.id || null)
    }
    window.addEventListener(KB_EVENT_NAME, handler as EventListener)

    return () => {
      window.removeEventListener(KB_EVENT_NAME, handler as EventListener)
    }
  }, [])

  useEffect(() => {
    if (!isMounted) return
    let cancelled = false

    const loadKnowledgeBases = async () => {
      const { data } = await supabase
        .from("knowledge_bases")
        .select("id,name")
        .order("name", { ascending: true })
      if (cancelled) return
      const options = Array.isArray(data)
        ? data
            .filter(item => !!item?.id && !!item?.name)
            .map(item => ({ id: String(item.id), name: String(item.name) }))
        : []
      setKnowledgeBaseOptions(options)
    }

    loadKnowledgeBases()
    return () => {
      cancelled = true
    }
  }, [isMounted, supabase])

  const loadRecentConversations = useCallback(async () => {
    const client = supabaseRef.current
    const { data, error } = await client
      .from("agent_conversations")
      .select("id, title, last_message_preview, last_message_at, knowledge_base_id")
      .order("updated_at", { ascending: false })
      .limit(15)
    if (error || !Array.isArray(data)) {
      setRecentConversations([])
      return
    }
    setRecentConversations(
      data.map(row => ({
        id: String(row.id),
        title: row.title ?? null,
        last_message_preview: row.last_message_preview ?? null,
        last_message_at: row.last_message_at ?? null,
        knowledge_base_id: row.knowledge_base_id ?? null
      }))
    )
  }, [])

  const loadConversationMessages = useCallback(async (convId: string) => {
    const client = supabaseRef.current
    setLoadingConversationId(convId)
    try {
      const { data, error } = await client
        .from("agent_messages")
        .select("id, role, content, tool_name, tool_status, tool_call_id, metadata")
        .eq("conversation_id", convId)
        .in("role", ["user", "assistant", "tool"])
        .order("created_at", { ascending: true })
      if (error || !Array.isArray(data)) {
        setMessages([])
        return
      }

      // Group tool rows that appear between assistant messages
      const msgs: ChatMessage[] = []
      let pendingToolActivities: ToolActivity[] = []

      for (const row of data) {
        if (row.role === "tool") {
          // Collect tool activities
          pendingToolActivities.push({
            id: String(row.tool_call_id || row.id),
            label: String(row.content || row.tool_name || "Tool-Ausführung"),
            status: (row.tool_status as ToolActivity["status"]) || "done",
            tool: row.tool_name || undefined
          })
          continue
        }

        // If there are pending tool activities, add them as a tool-activity message
        if (pendingToolActivities.length > 0) {
          msgs.push({
            id: `tools-${pendingToolActivities[0].id}`,
            role: "assistant",
            content: "",
            toolActivities: [...pendingToolActivities]
          })
          pendingToolActivities = []
        }

        // Parse richContent and toolActivities from metadata if available
        const metadata = typeof row.metadata === "object" && row.metadata !== null ? row.metadata as Record<string, any> : null
        const savedRichContent = metadata?.richContent || null
        const savedToolActivities = Array.isArray(metadata?.toolActivities) ? metadata.toolActivities as ToolActivity[] : undefined

        // If the assistant message has saved toolActivities in metadata and we didn't get them from tool rows,
        // insert a tool-activity message before the text message
        if (row.role === "assistant" && savedToolActivities && savedToolActivities.length > 0) {
          msgs.push({
            id: `tools-meta-${row.id}`,
            role: "assistant",
            content: "",
            toolActivities: savedToolActivities
          })
        }

        msgs.push({
          id: String(row.id),
          role: row.role === "assistant" ? "assistant" : "user",
          content: String(row.content ?? ""),
          richContent: savedRichContent
        })
      }

      // Flush any remaining tool activities
      if (pendingToolActivities.length > 0) {
        msgs.push({
          id: `tools-${pendingToolActivities[0].id}`,
          role: "assistant",
          content: "",
          toolActivities: [...pendingToolActivities]
        })
      }

      setChoiceSelections({})
      setChoiceErrors({})
      setSubmittingChoiceId(null)
      setEditingMessageId(null)
      setEditingMessageText("")
      setIsRegeneratingFromEdit(false)
      setMessages(msgs)
      setConversationId(convId)
    } finally {
      setLoadingConversationId(null)
    }
  }, [])

  const startNewChat = useCallback(() => {
    setConversationId(null)
    setMessages([])
    setToolActivities([])
    setExpandedToolIds({})
    setChoiceSelections({})
    setChoiceErrors({})
    setSubmittingChoiceId(null)
    setEditingMessageId(null)
    setEditingMessageText("")
    setIsRegeneratingFromEdit(false)
    setHistoryOpen(false)
    // Welcome message wird durch Effect gesetzt wenn messages.length === 0
  }, [])

  const stopDocumentStatusPolling = useCallback((documentId: string) => {
    const timerId = documentStatusPollersRef.current[documentId]
    if (timerId) {
      window.clearInterval(timerId)
      delete documentStatusPollersRef.current[documentId]
    }
    delete documentStatusInFlightRef.current[documentId]
  }, [])

  const fetchDocumentReferenceStatus = useCallback(
    async (documentId: string) => {
      if (!documentId) return
      if (documentStatusInFlightRef.current[documentId]) return
      documentStatusInFlightRef.current[documentId] = true

      try {
        const {
          data: { session }
        } = await supabaseRef.current.auth.getSession()
        const token = session?.access_token

        if (!token) {
          setDocumentReferenceStates(prev => ({
            ...prev,
            [documentId]: {
              phase: "unknown",
              statusRaw: null,
              progress: prev[documentId]?.progress ?? 8,
              error: "Keine Authentifizierung für Statusabfrage."
            }
          }))
          return
        }

        const response = await fetch(`/api/cursor/status?document_id=${encodeURIComponent(documentId)}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`
          }
        })

        if (!response.ok) {
          let apiError = `Statusabfrage fehlgeschlagen (${response.status}).`
          try {
            const payload = await response.json()
            if (payload?.error) {
              apiError = String(payload.error)
            }
          } catch {
            // ignore parsing errors
          }

          setDocumentReferenceStates(prev => ({
            ...prev,
            [documentId]: {
              phase: "unknown",
              statusRaw: null,
              progress: prev[documentId]?.progress ?? 8,
              error: apiError
            }
          }))
          return
        }

        const payload = await response.json()
        const statusRaw = typeof payload?.status === "string" ? payload.status : null
        const phase = mapDocumentPhase(statusRaw)
        const progressFromApi = normalizeProgress(payload?.progress, phase === "completed" ? 100 : 0)
        const progress =
          phase === "completed"
            ? 100
            : phase === "failed"
              ? progressFromApi
              : Math.max(progressFromApi, 8)

        setDocumentReferenceStates(prev => ({
          ...prev,
          [documentId]: {
            phase,
            statusRaw,
            progress,
            message: typeof payload?.message === "string" ? payload.message : null,
            error: typeof payload?.error === "string" ? payload.error : null,
            updatedAt: typeof payload?.updated_at === "string" ? payload.updated_at : null
          }
        }))

        if (phase === "completed" || phase === "failed") {
          stopDocumentStatusPolling(documentId)
        }
      } catch (error: any) {
        setDocumentReferenceStates(prev => ({
          ...prev,
          [documentId]: {
            phase: "unknown",
            statusRaw: null,
            progress: prev[documentId]?.progress ?? 8,
            error: error?.message || "Statusabfrage fehlgeschlagen."
          }
        }))
      } finally {
        documentStatusInFlightRef.current[documentId] = false
      }
    },
    [stopDocumentStatusPolling]
  )

  const startRenameConversation = useCallback((conv: ConversationSummary) => {
    const currentName =
      conv.title?.trim() ||
      (conv.last_message_preview ? conv.last_message_preview.slice(0, 50) + (conv.last_message_preview.length > 50 ? "…" : "") : "") ||
      "Chat"
    setEditingConvId(conv.id)
    setEditingTitle(currentName)
  }, [])

  const saveRenameConversation = useCallback(async () => {
    if (!editingConvId || !editingTitle.trim()) {
      setEditingConvId(null)
      setEditingTitle("")
      return
    }
    const client = supabaseRef.current
    const { error } = await client
      .from("agent_conversations")
      .update({ title: editingTitle.trim() })
      .eq("id", editingConvId)
    setEditingConvId(null)
    setEditingTitle("")
    if (!error) loadRecentConversations()
  }, [editingConvId, editingTitle, loadRecentConversations])

  const cancelRenameConversation = useCallback(() => {
    setEditingConvId(null)
    setEditingTitle("")
  }, [])

  const handleDeleteConversation = useCallback(async (conv: ConversationSummary) => {
    const client = supabaseRef.current
    const { error } = await client.from("agent_conversations").delete().eq("id", conv.id)
    if (!error) {
      loadRecentConversations()
      if (conversationId === conv.id) startNewChat()
    }
  }, [loadRecentConversations, startNewChat, conversationId])

  useEffect(() => {
    if (editingConvId) {
      const t = setTimeout(() => renameInputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [editingConvId])

  useEffect(() => {
    if (isRendered && isExpanded) {
      loadRecentConversations()
    }
  }, [isRendered, isExpanded, loadRecentConversations])

  useEffect(() => {
    if (conversationId && isRendered) {
      loadRecentConversations()
    }
  }, [conversationId, isRendered, loadRecentConversations])

  useEffect(() => {
    if (!isExpanded || messages.length > 0) return
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: `Hallo ${resolvedName} - ich helfe dir direkt in der Wissensdatenbank.

Kurz was ich kann:
1. Wissensdatenbanken und Dokumente finden, anlegen und verwalten
2. Chunks und Fakten suchen, analysieren, erstellen, bearbeiten und loeschen
3. Inhalte aus Text, Datei-URL oder Webseite importieren
4. Web-Recherche nutzen und Ergebnisse mit Quellen aufbereiten

Sag einfach kurz dein Ziel, z. B. "Suche nach ...", "Importiere diese URL ..." oder "Erstelle einen neuen Chunk zu ...".`
      }
    ])
  }, [isExpanded, messages.length, resolvedName])

  useEffect(() => {
    if (!chatScrollRef.current) return
    chatScrollRef.current.scrollTop = 0
  }, [messages, isThinking, toolActivities])

  useEffect(() => {
    if (!isRendered) return

    for (const documentId of referencedDocumentIds) {
      const existing = documentReferenceStatesRef.current[documentId]
      if (existing?.phase === "completed" || existing?.phase === "failed") continue

      if (!documentStatusPollersRef.current[documentId]) {
        setDocumentReferenceStates(prev => ({
          ...prev,
          [documentId]:
            prev[documentId] ||
            ({
              phase: "loading",
              statusRaw: null,
              progress: 8
            } satisfies DocumentReferenceState)
        }))

        void fetchDocumentReferenceStatus(documentId)
        documentStatusPollersRef.current[documentId] = window.setInterval(() => {
          void fetchDocumentReferenceStatus(documentId)
        }, 2500)
      }
    }

    for (const [documentId, timerId] of Object.entries(documentStatusPollersRef.current)) {
      if (!referencedDocumentIds.includes(documentId)) {
        window.clearInterval(timerId)
        delete documentStatusPollersRef.current[documentId]
        delete documentStatusInFlightRef.current[documentId]
      }
    }
  }, [isRendered, referencedDocumentIds, fetchDocumentReferenceStatus])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
      for (const timerId of Object.values(documentStatusPollersRef.current)) {
        window.clearInterval(timerId)
      }
      documentStatusPollersRef.current = {}
      documentStatusInFlightRef.current = {}
    }
  }, [])

  useEffect(() => {
    if (!isRendered) return

    const refreshRect = () => {
      if (triggerRef.current) {
        setAnchorRect(triggerRef.current.getBoundingClientRect())
      } else {
        // Mobile: fullscreen
        setAnchorRect(new DOMRect(0, 0, window.innerWidth, 0))
      }
    }

    refreshRect()
    window.addEventListener("resize", refreshRect)
    window.addEventListener("scroll", refreshRect, { passive: true })

    return () => {
      window.removeEventListener("resize", refreshRect)
      window.removeEventListener("scroll", refreshRect)
    }
  }, [isRendered])

  useEffect(() => {
    if (!isRendered) {
      setIsKbPickerOpen(false)
    }
  }, [isRendered])

  useEffect(() => {
    if (!isExpanded) return

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 170)

    return () => window.clearTimeout(focusTimer)
  }, [isExpanded])

  useEffect(() => {
    const el = tabsScrollRef.current
    if (!el || !isRendered) return
    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      el.scrollLeft += e.deltaY * 2
    }
    el.addEventListener("wheel", handler, { passive: false })
    return () => el.removeEventListener("wheel", handler)
  }, [isRendered])

  useEffect(() => {
    if (!isRendered) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const targetElement =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? (event.target.parentElement as Element | null)
            : null
      const clickedTrigger = !!triggerRef.current?.contains(target)
      const clickedFloatingBtn = !!floatingBtnRef.current?.contains(target)
      const clickedPanel = !!panelRef.current?.contains(target)
      const clickedAgentDropdown =
        !!targetElement?.closest('[data-agent-dropdown="true"]') ||
        !!targetElement?.closest('[data-radix-popper-content-wrapper]')

      if (!clickedTrigger && !clickedFloatingBtn && !clickedPanel && !clickedAgentDropdown) {
        closeChat()
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeChat()
      }
    }

    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [isRendered])

  const finishToolActivity = (id: string, status: "done" | "error") => {
    setToolActivities(prev => prev.map(item => (item.id === id ? { ...item, status } : item)))
  }

  const getAuthToken = async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || null
  }

  const streamAssistantMessage = async (content: string, richContent?: AgentRichContent | null) => {
    const id = `assistant-${Date.now()}`
    const safeContent = String(content || "").trim()
    const shouldAnimate = !richContent || !Array.isArray(richContent.blocks) || richContent.blocks.length === 0

    setMessages(prev => [
      ...prev,
      { id, role: "assistant", content: shouldAnimate ? "" : safeContent, richContent: richContent || null }
    ])

    if (!shouldAnimate) {
      return
    }

    // Preserve line breaks and markdown spacing while streaming.
    const chunks = safeContent.match(/\S+\s*/g) || []
    if (chunks.length === 0) {
      setMessages(prev => prev.map(msg => (msg.id === id ? { ...msg, content: safeContent } : msg)))
      return
    }

    let next = ""
    for (let i = 0; i < chunks.length; i++) {
      next += chunks[i]
      setMessages(prev => prev.map(msg => (msg.id === id ? { ...msg, content: next } : msg)))
      await sleep(12)
    }

    // Ensure exact final content (incl. markdown/newline layout).
    setMessages(prev => prev.map(msg => (msg.id === id ? { ...msg, content: safeContent } : msg)))
  }

  const runAgent = async (rawMessage: string, history: AgentHistoryMessage[], attachments?: AgentAttachment[]) => {
    const message = compact(rawMessage)
    if (!message) return

    const pendingId = `agent-${Date.now()}`
    setToolActivities([
      {
        id: pendingId,
        label: attachments && attachments.length > 0
          ? `Agent analysiert die Anfrage (${attachments.length} Anhang${attachments.length > 1 ? "e" : ""})...`
          : "Agent analysiert die Anfrage...",
        status: "running"
      }
    ])

    try {
      const token = await getAuthToken()
      if (!token) {
        throw new Error("Keine Session gefunden.")
      }

      const requestBody: any = {
        message,
        knowledgeBaseId,
        conversationId,
        history,
        stream: true
      }
      if (attachments && attachments.length > 0) {
        requestBody.attachments = attachments
      }

      const response = await fetch("/api/knowledge/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      })
      const contentType = (response.headers.get("content-type") || "").toLowerCase()

      if (response.ok && contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let hasToolMessage = false
        const liveToolMessageId = `assistant-tools-live-${Date.now()}`
        const liveActivities = new Map<string, ToolActivity>()
        let streamingMessageId: string | null = null
        let streamedText = ""

        const ensureToolMessage = () => {
          if (hasToolMessage) return
          hasToolMessage = true
          setMessages(prev => [
            ...prev,
            {
              id: liveToolMessageId,
              role: "assistant",
              content: "",
              toolActivities: []
            }
          ])
        }

        const flushActivities = () => {
          const ordered = Array.from(liveActivities.values())
          setToolActivities(ordered)
          setMessages(prev =>
            prev.map(item =>
              item.id === liveToolMessageId
                ? {
                    ...item,
                    toolActivities: ordered
                  }
                : item
            )
          )
        }

        const normalizeActivity = (activity: any, fallbackId: string): ToolActivity => ({
          id: String(activity?.id || fallbackId),
          label: String(activity?.label || activity?.tool || "Tool-Ausführung"),
          status: (activity?.status as ToolActivity["status"]) || "done",
          tool: typeof activity?.tool === "string" ? activity.tool : undefined,
          error: typeof activity?.error === "string" ? activity.error : undefined,
          details: {
            lines: Array.isArray(activity?.details?.lines)
              ? activity.details.lines.map((line: any) => String(line))
              : [],
            links: Array.isArray(activity?.details?.links)
              ? activity.details.links
                  .filter((link: any) => !!link?.url)
                  .map((link: any) => ({ title: String(link?.title || link?.url), url: String(link?.url) }))
              : []
          }
        })
        const ensureStreamingMessage = () => {
          if (streamingMessageId) return
          streamingMessageId = `assistant-stream-${Date.now()}`
          finishToolActivity(pendingId, "done")
          setMessages(prev => [...prev, { id: streamingMessageId!, role: "assistant", content: "" }])
        }

        const parseSseChunk = (rawChunk: string) => {
          const lines = rawChunk.split(/\r?\n/)
          let eventName = "message"
          const dataLines: string[] = []
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim()
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim())
            }
          }
          const dataText = dataLines.join("\n")
          let payload: any = {}
          if (dataText) {
            try {
              payload = JSON.parse(dataText)
            } catch {
              payload = { raw: dataText }
            }
          }
          return { eventName, payload }
        }

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let boundaryIndex = buffer.indexOf("\n\n")
          while (boundaryIndex !== -1) {
            const rawEvent = buffer.slice(0, boundaryIndex).trim()
            buffer = buffer.slice(boundaryIndex + 2)
            boundaryIndex = buffer.indexOf("\n\n")
            if (!rawEvent) continue

            const { eventName, payload } = parseSseChunk(rawEvent)

            if (eventName === "context") {
              const nextKbId =
                typeof payload?.activeKnowledgeBaseId === "string" && payload.activeKnowledgeBaseId.trim().length > 0
                  ? payload.activeKnowledgeBaseId
                  : null
              if (nextKbId !== knowledgeBaseId) {
                setKnowledgeBaseId(nextKbId)
                syncKnowledgeBaseSelection(nextKbId)
              }

              const nextConversationId =
                typeof payload?.conversationId === "string" && payload.conversationId.trim().length > 0
                  ? payload.conversationId.trim()
                  : null
              if (nextConversationId && nextConversationId !== conversationId) {
                setConversationId(nextConversationId)
              }
              continue
            }

            if (eventName === "tool_start" || eventName === "tool_done" || eventName === "tool_error") {
              ensureToolMessage()
              if (eventName === "tool_start") playWarning()
              else if (eventName === "tool_done") playSuccess()
              else if (eventName === "tool_error") playError()
              const fallbackId = `tool-${Date.now()}`
              const normalized = normalizeActivity(payload, fallbackId)
              liveActivities.set(normalized.id, normalized)
              flushActivities()
              continue
            }

            // Real-time token streaming
            if (eventName === "text_delta") {
              const deltaText = typeof payload?.text === "string" ? payload.text : ""
              if (deltaText) {
                ensureStreamingMessage()
                streamedText += deltaText
                const capturedId = streamingMessageId!
                const capturedText = streamedText
                setMessages(prev => prev.map(msg => msg.id === capturedId ? { ...msg, content: capturedText } : msg))
              }
              continue
            }

            // Rich content arrives after text is complete
            if (eventName === "assistant_done") {
              if (streamingMessageId && payload?.richContent) {
                const richContent = payload.richContent as AgentRichContent
                const capturedId = streamingMessageId
                setMessages(prev => prev.map(msg => msg.id === capturedId ? { ...msg, richContent } : msg))
              }
              continue
            }

            // Final done event with metadata
            if (eventName === "done") {
              const nextKbId =
                typeof payload?.activeKnowledgeBaseId === "string" && payload.activeKnowledgeBaseId.trim().length > 0
                  ? payload.activeKnowledgeBaseId
                  : null
              if (nextKbId && nextKbId !== knowledgeBaseId) {
                setKnowledgeBaseId(nextKbId)
                syncKnowledgeBaseSelection(nextKbId)
              }
              const nextConvId =
                typeof payload?.conversationId === "string" && payload.conversationId.trim().length > 0
                  ? payload.conversationId.trim()
                  : null
              if (nextConvId && nextConvId !== conversationId) {
                setConversationId(nextConvId)
              }
              if (Array.isArray(payload?.toolActivities) && payload.toolActivities.length > 0 && liveActivities.size === 0) {
                ensureToolMessage()
                for (let i = 0; i < payload.toolActivities.length; i++) {
                  const item = normalizeActivity(payload.toolActivities[i], `tool-${i}`)
                  liveActivities.set(item.id, item)
                }
                flushActivities()
              }
              if (!streamingMessageId && !streamedText) {
                finishToolActivity(pendingId, "done")
              }
              continue
            }

            // Legacy: handle old-style assistant event for backward compatibility
            if (eventName === "assistant") {
              const data = payload as AgentApiResponse

              const returnedKbId =
                typeof data.activeKnowledgeBaseId === "string" && data.activeKnowledgeBaseId.trim().length > 0
                  ? data.activeKnowledgeBaseId
                  : null
              if (returnedKbId !== knowledgeBaseId) {
                setKnowledgeBaseId(returnedKbId)
                syncKnowledgeBaseSelection(returnedKbId)
              }

              const returnedConversationId =
                typeof data.conversationId === "string" && data.conversationId.trim().length > 0
                  ? data.conversationId.trim()
                  : null
              if (returnedConversationId && returnedConversationId !== conversationId) {
                setConversationId(returnedConversationId)
              }

              if (Array.isArray(data.toolActivities) && data.toolActivities.length > 0) {
                ensureToolMessage()
                for (let i = 0; i < data.toolActivities.length; i++) {
                  const item = normalizeActivity(data.toolActivities[i], `tool-${i}`)
                  liveActivities.set(item.id, item)
                }
                flushActivities()
              } else if (liveActivities.size === 0) {
                finishToolActivity(pendingId, "done")
              }

              const assistantMessage = String(data.message || "Ich konnte keine Antwort erzeugen.")
              const richContent = normalizeRichContent(data.richContent, assistantMessage)
              await streamAssistantMessage(assistantMessage, richContent)
              continue
            }

            if (eventName === "error") {
              const errText = String(payload?.error || "Agent-Stream fehlgeschlagen.")
              throw new Error(errText)
            }
          }
        }

        return
      }

      const data: AgentApiResponse = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Agent-Request fehlgeschlagen.")
      }

      const returnedKbId =
        typeof data.activeKnowledgeBaseId === "string" && data.activeKnowledgeBaseId.trim().length > 0
          ? data.activeKnowledgeBaseId
          : null

      if (returnedKbId !== knowledgeBaseId) {
        setKnowledgeBaseId(returnedKbId)
        syncKnowledgeBaseSelection(returnedKbId)
      }

      const returnedConversationId =
        typeof data.conversationId === "string" && data.conversationId.trim().length > 0
          ? data.conversationId.trim()
          : null
      if (returnedConversationId && returnedConversationId !== conversationId) {
        setConversationId(returnedConversationId)
      }

      const normalizedActivities = Array.isArray(data.toolActivities)
        ? data.toolActivities.map((activity, index) => ({
            id: activity.id || `tool-${index}`,
            label: activity.label || activity.tool || "Tool-Ausführung",
            status: activity.status || "done",
            tool: activity.tool || undefined,
            error: activity.error || undefined,
            details: {
              lines: Array.isArray(activity.details?.lines)
                ? activity.details?.lines.map(line => String(line))
                : [],
              links: Array.isArray(activity.details?.links)
                ? activity.details?.links
                    .filter(link => !!link?.url)
                    .map(link => ({ title: String(link?.title || link?.url), url: String(link?.url) }))
                : []
            }
          }))
        : []

      if (normalizedActivities.length > 0) {
        setToolActivities(normalizedActivities)
        setMessages(prev => [
          ...prev,
          {
            id: `assistant-tools-${Date.now()}`,
            role: "assistant",
            content: "",
            toolActivities: normalizedActivities
          }
        ])
        const hasDone = normalizedActivities.some(a => a.status === "done")
        if (hasDone) playSuccess()
      } else {
        finishToolActivity(pendingId, "done")
      }

      const assistantMessage = String(data.message || "Ich konnte keine Antwort erzeugen.")
      const richContent = normalizeRichContent(data.richContent, assistantMessage)
      await streamAssistantMessage(assistantMessage, richContent)
    } catch (error: any) {
      const rawErrorMessage = String(error?.message || "")
      const isNetworkFetchError =
        rawErrorMessage.toLowerCase().includes("failed to fetch") ||
        rawErrorMessage.toLowerCase().includes("networkerror")

      const readableErrorMessage = isNetworkFetchError
        ? "Server nicht erreichbar. Bitte Seite neu laden oder Dev-Server prüfen."
        : error?.message || "Unbekannter Fehler"

      playError()
      setToolActivities([
        {
          id: pendingId,
          label: isNetworkFetchError ? "Server nicht erreichbar" : "Agent-Aufruf fehlgeschlagen",
          status: "error"
        }
      ])
      await streamAssistantMessage(`Agent-Fehler: ${readableErrorMessage}`, null)
    }
  }

  // -----------------------------------------------------------------------
  // Attachment handling
  // -----------------------------------------------------------------------
  const MAX_ATTACHMENTS = 20
  const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB (same as regular upload)
  const ACCEPTED_TYPES = "image/*,.pdf,.doc,.docx,.txt,.md,.html,.eml,.msg,.rtf,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.bmp,.webp,.tiff,.tif"
  const SYSTEM_FILES = new Set([".ds_store", "thumbs.db", ".gitkeep", ".gitignore", "desktop.ini", ".spotlight-v100", ".trashes"])

  const handleFileSelect = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files)
      .filter(f => !SYSTEM_FILES.has(f.name.toLowerCase()) && !f.name.startsWith("._"))
    const available = MAX_ATTACHMENTS - pendingAttachments.length
    if (available <= 0) return
    const toAdd = fileArray.slice(0, available)

    const newAttachments: PendingAttachment[] = toAdd
      .filter(file => file.size <= MAX_FILE_SIZE)
      .map(file => ({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size
      }))

    if (newAttachments.length > 0) {
      setPendingAttachments(prev => [...prev, ...newAttachments])
    }
  }, [pendingAttachments.length])

  const removeAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments(prev => {
      const removed = prev.find(a => a.id === attachmentId)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter(a => a.id !== attachmentId)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    pendingAttachments.forEach(a => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    })
    setPendingAttachments([])
  }, [pendingAttachments])

  const uploadAttachmentsToStorage = useCallback(async (): Promise<AgentAttachment[]> => {
    if (pendingAttachments.length === 0) return []
    setIsUploading(true)
    try {
      const uploaded: AgentAttachment[] = []
      for (const att of pendingAttachments) {
        try {
          const formData = new FormData()
          formData.append("file", att.file)
          const res = await fetch("/api/agent-upload", { method: "POST", body: formData })
          if (!res.ok) { console.error("Upload-Fehler:", (await res.json().catch(() => ({}))).error); continue }
          const data = await res.json()
          if (data.url) {
            uploaded.push({ url: data.url, name: data.name || att.name, type: data.type || att.type, size: data.size || att.size })
          }
        } catch (err: any) {
          console.error("Upload-Fehler:", err.message)
        }
      }
      return uploaded
    } finally {
      setIsUploading(false)
    }
  }, [pendingAttachments])

  const openChat = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    if (triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect())
    } else {
      // Mobile: fullscreen panel
      setAnchorRect(new DOMRect(0, 0, window.innerWidth, 0))
    }
    setIsRendered(true)
    window.requestAnimationFrame(() => setIsExpanded(true))
  }

  const closeChat = () => {
    setIsExpanded(false)
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = window.setTimeout(() => {
      setIsRendered(false)
      closeTimerRef.current = null
    }, CLOSE_ANIMATION_MS)
  }

  const submitUserMessage = async (displayValue: string, agentValue?: string) => {
    const userText = compact(displayValue)
    if (!userText || isThinking) return
    if (!isRendered) {
      openChat()
    }

    const promptForAgent = compact(agentValue || displayValue)
    if (!promptForAgent) return

    // Upload pending attachments
    let uploadedAttachments: AgentAttachment[] = []
    if (pendingAttachments.length > 0) {
      uploadedAttachments = await uploadAttachmentsToStorage()
      clearAttachments()
    }

    const historyForAgent: AgentHistoryMessage[] = messages
      .slice(-14)
      .map(item => ({ role: item.role, content: item.content }))

    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: "user",
      content: userText,
      attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined
    }])
    playClick()
    setIsThinking(true)
    setToolActivities([])
    playWorking()

    try {
      await runAgent(promptForAgent, historyForAgent, uploadedAttachments)
    } finally {
      setIsThinking(false)
    }
  }

  const startEditingMessage = (message: ChatMessage) => {
    if (message.role !== "user" || isThinking || isRegeneratingFromEdit) return
    setEditingMessageId(message.id)
    setEditingMessageText(message.content)
  }

  const cancelEditingMessage = () => {
    setEditingMessageId(null)
    setEditingMessageText("")
  }

  const regenerateFromEditedMessage = async (message: ChatMessage, messageIndex: number) => {
    if (isThinking || isRegeneratingFromEdit) return
    const nextText = compact(editingMessageText)
    if (!nextText) return
    if (!isRendered) openChat()

    const previousMessages = messages.slice(0, messageIndex)
    const historyForAgent: AgentHistoryMessage[] = previousMessages
      .slice(-14)
      .map(item => ({ role: item.role, content: item.content }))
    const editedAttachments = Array.isArray(message.attachments) ? message.attachments : []

    setIsRegeneratingFromEdit(true)
    try {
      if (conversationId) {
        const { data: anchor } = await supabase
          .from("agent_messages")
          .select("id, created_at")
          .eq("conversation_id", conversationId)
          .eq("id", message.id)
          .maybeSingle()
        if (anchor?.created_at) {
          await supabase
            .from("agent_messages")
            .delete()
            .eq("conversation_id", conversationId)
            .gte("created_at", anchor.created_at)
        }
      }

      setMessages([
        ...previousMessages,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: nextText,
          attachments: editedAttachments.length > 0 ? editedAttachments : undefined
        }
      ])
      cancelEditingMessage()
      setIsThinking(true)
      setToolActivities([])
      await runAgent(nextText, historyForAgent, editedAttachments)
    } finally {
      setIsThinking(false)
      setIsRegeneratingFromEdit(false)
    }
  }

  const submitInput = async () => {
    const value = compact(input)
    if (!value && pendingAttachments.length === 0) return
    if (isThinking) return

    const expandedValue = expandSlashCommand(value || "Bitte schau dir die angehängten Dateien an.")
    setInput("")
    await submitUserMessage(value || "Angehängte Dateien", expandedValue)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitInput()
  }

  const renderRichBlock = (block: AgentRichBlock, blockIndex: number, messageId: string) => {
    if (block.type === "text") {
      return (
        <div key={`text-${blockIndex}`} className="text-[13px] leading-[1.7] text-white/75">
          <MarkdownMessage content={block.text} />
        </div>
      )
    }

    if (block.type === "code") {
      return (
        <div key={`code-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-[#0d0d0f] overflow-hidden">
          {(block.title || block.language) && (
            <div className="flex items-center justify-between border-b border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="truncate">{block.title || "Code"}</span>
              <span>{block.language || "text"}</span>
            </div>
          )}
          <pre className="max-h-64 overflow-auto p-2.5 text-[12px] leading-relaxed text-white/70">
            <code>{block.content}</code>
          </pre>
        </div>
      )
    }

    if (block.type === "table") {
      return (
        <div key={`table-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-[#0d0d0f]/80 overflow-hidden shadow-sm [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {block.title && (
            <div className="border-b border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-white/70">
              {block.title}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-white/[0.06]">
                {block.columns.map((column, columnIndex) => (
                  <TableHead
                    key={`${column}-${columnIndex}`}
                    className="text-[12px] font-semibold text-white/50"
                  >
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((row, rowIndex) => (
                <TableRow key={`row-${rowIndex}`} className="border-white/[0.04]">
                  {row.map((cell, cellIndex) => (
                    <TableCell key={`cell-${rowIndex}-${cellIndex}`} className="text-[12px] text-white/70 py-2">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )
    }

    if (block.type === "image") {
      return (
        <figure key={`image-${blockIndex}`} className="overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.02]">
          {block.title && (
            <figcaption className="border-b border-white/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-white/70">
              {block.title}
            </figcaption>
          )}
          <img
            src={block.url}
            alt={block.alt || block.title || "Agent-Bild"}
            className="max-h-80 w-full object-contain bg-muted/30"
            loading="lazy"
          />
        </figure>
      )
    }

    if (block.type === "interactive_choices") {
      const blockKey = `${messageId}:${blockIndex}`
      const options = Array.isArray(block.options)
        ? block.options.filter(option => !!option?.id && !!option?.label).slice(0, 12)
        : []
      if (options.length < 2) return null

      const selectionMode: "single" | "multiple" | "either_or" =
        block.selectionMode === "multiple"
          ? "multiple"
          : block.selectionMode === "either_or"
            ? "either_or"
            : "single"
      const isMultiSelect = selectionMode === "multiple"
      const selectedIds = choiceSelections[blockKey] || []

      const minSelectionsRaw = typeof block.minSelections === "number" ? Math.round(block.minSelections) : 1
      const maxSelectionsRaw = typeof block.maxSelections === "number" ? Math.round(block.maxSelections) : (isMultiSelect ? options.length : 1)
      const minSelections = Math.max(0, Math.min(options.length, minSelectionsRaw))
      const maxSelections = Math.max(minSelections || 1, Math.min(options.length, maxSelectionsRaw))

      const choiceError = choiceErrors[blockKey] || null
      const isSubmitting = submittingChoiceId === blockKey

      const selectedLabels = options
        .filter(option => selectedIds.includes(option.id))
        .map(option => option.label)

      const toggleChoice = (optionId: string) => {
        setChoiceErrors(prev => ({
          ...prev,
          [blockKey]: null
        }))

        setChoiceSelections(prev => {
          const current = prev[blockKey] || []

          if (!isMultiSelect) {
            return {
              ...prev,
              [blockKey]: [optionId]
            }
          }

          const hasOption = current.includes(optionId)
          if (hasOption) {
            return {
              ...prev,
              [blockKey]: current.filter(id => id !== optionId)
            }
          }

          if (current.length >= maxSelections) {
            setChoiceErrors(prevErrors => ({
              ...prevErrors,
              [blockKey]: `Maximal ${maxSelections} Auswahl${maxSelections === 1 ? "" : "en"} möglich.`
            }))
            return prev
          }

          return {
            ...prev,
            [blockKey]: [...current, optionId]
          }
        })
      }

      const submitChoice = async () => {
        if (isThinking || isSubmitting) return

        const count = selectedIds.length
        if (count < minSelections) {
          setChoiceErrors(prev => ({
            ...prev,
            [blockKey]: `Bitte mindestens ${minSelections} Option${minSelections === 1 ? "" : "en"} wählen.`
          }))
          return
        }
        if (count > maxSelections) {
          setChoiceErrors(prev => ({
            ...prev,
            [blockKey]: `Bitte maximal ${maxSelections} Option${maxSelections === 1 ? "" : "en"} wählen.`
          }))
          return
        }

        const responsePrefix = (block.responsePrefix || "Auswahl").trim()
        const responseMessage = `${responsePrefix}: ${selectedLabels.join(", ")}`

        setSubmittingChoiceId(blockKey)
        try {
          await submitUserMessage(responseMessage, responseMessage)
        } finally {
          setSubmittingChoiceId(current => (current === blockKey ? null : current))
        }
      }

      const submitDisabled = isThinking || isSubmitting || selectedIds.length < minSelections
      const submitLabel =
        block.submitLabel ||
        (isMultiSelect ? "Auswahl senden" : selectionMode === "either_or" ? "Entscheidung senden" : "Option senden")

      return (
        <div key={`interactive-${blockKey}`} className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] to-transparent p-3 space-y-2.5">
          {block.title && (
            <div className="text-[12px] font-medium text-white/80">{block.title}</div>
          )}
          <div className="text-[13px] leading-[1.7] text-white/75">
            <MarkdownMessage content={block.prompt} />
          </div>
          <div className="space-y-1.5">
            {options.map(option => {
              const isSelected = selectedIds.includes(option.id)
              return (
                <button
                  key={`${blockKey}-${option.id}`}
                  type="button"
                  onClick={() => toggleChoice(option.id)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition-all duration-200 ${
                    isSelected
                      ? "border-pink-500/20 bg-gradient-to-r from-pink-500/[0.06] to-transparent text-white/80"
                      : "border-white/[0.06] bg-white/[0.02] text-white/55 hover:border-white/[0.1] hover:text-white/75 hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-[1px] inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ${
                        isSelected ? "border-pink-400/70 bg-pink-500/80" : "border-white/20"
                      }`}
                    >
                      {isSelected ? <Check className="size-2.5 text-white" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] leading-relaxed text-white/80">{option.label}</span>
                      {option.description && (
                        <span className="block text-[10.5px] text-muted-foreground mt-0.5">{option.description}</span>
                      )}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="text-[10.5px] text-muted-foreground">
              {isMultiSelect
                ? `${selectedIds.length} gewählt · min ${minSelections}, max ${maxSelections}`
                : selectedIds.length > 0
                  ? "1 Auswahl gesetzt"
                  : "Bitte eine Option wählen"}
            </div>
            <button
              type="button"
              onClick={submitChoice}
              disabled={submitDisabled}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-foreground transition-colors hover:border-white/30 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="size-3 animate-spin" /> : <ArrowDown className="size-3" />}
              <span>{submitLabel}</span>
            </button>
          </div>
          {choiceError && (
            <div className="text-[10.5px] text-muted-foreground">{choiceError}</div>
          )}
        </div>
      )
    }

    return null
  }

  const renderAssistantBody = (message: ChatMessage) => {
    if (Array.isArray(message.toolActivities) && message.toolActivities.length > 0) {
      return (
        <div className="space-y-2">
          {message.toolActivities.map(activity => {
            const isExpanded = !!expandedToolIds[activity.id]
            const hasDetails =
              (activity.details?.lines && activity.details.lines.length > 0) ||
              (activity.details?.links && activity.details.links.length > 0)
            return (
              <div
                key={activity.id}
                className={`rounded-xl border px-3 py-2.5 text-xs text-muted-foreground transition-all duration-300 ${
                  activity.status === "running"
                    ? "border-white/[0.08] bg-gradient-to-r from-white/[0.04] to-transparent"
                    : activity.status === "error"
                      ? "border-red-500/15 bg-red-500/[0.03]"
                      : "border-white/[0.05] bg-white/[0.015]"
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    hasDetails &&
                    setExpandedToolIds(prev => ({
                      ...prev,
                      [activity.id]: !prev[activity.id]
                    }))
                  }
                  className="flex w-full items-center gap-2 text-left"
                >
                  <Wrench className={`size-3 ${activity.status === "running" ? "text-pink-400 agent-tool-pulse" : "text-pink-500"}`} />
                  <span className="truncate">{activity.label}</span>
                  <span className="ml-auto flex items-center">
                    {activity.status === "running" ? (
                      <span className="flex items-center gap-1">
                        <span className="agent-thinking-dot inline-block size-1 rounded-full bg-pink-400/50" />
                        <span className="agent-thinking-dot inline-block size-1 rounded-full bg-pink-400/50" />
                        <span className="agent-thinking-dot inline-block size-1 rounded-full bg-pink-400/50" />
                      </span>
                    ) : activity.status === "done" ? <Check className="size-3.5 text-pink-500" /> : <span className="text-red-400 text-[10px]">Fehler</span>}
                  </span>
                </button>
                {hasDetails && isExpanded && (
                  <div className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2">
                    {(activity.details?.lines || []).map((line, index) => (
                      <div key={`${activity.id}-line-${index}`} className="text-[11px] text-muted-foreground">
                        {line}
                      </div>
                    ))}
                    {(activity.details?.links || []).map((link, index) => (
                      <a
                        key={`${activity.id}-link-${index}`}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[11px] text-foreground/80 underline underline-offset-2"
                      >
                        {link.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )
    }

    const richContent = message.richContent
    const blocks = Array.isArray(richContent?.blocks) ? richContent.blocks : []
    const references = Array.isArray(richContent?.references) ? richContent.references : []

    if (blocks.length === 0 && references.length === 0) {
      return (
        <div className="text-[13px] leading-[1.7] text-white/75">
          <MarkdownMessage content={message.content} />
        </div>
      )
    }

    return (
      <div className="space-y-2.5">
        {blocks.map((block, index) => renderRichBlock(block, index, message.id))}
        {references.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {references.slice(0, 12).map((reference, index) => (
              (() => {
                const isDocumentReference = reference.type === "document"
                const shouldTrackDocumentStatus = isDocumentReference && reference.checkProcessing === true
                const documentId = isDocumentReference
                  ? String(reference.documentId || reference.id || "").trim()
                  : null
                const documentState = shouldTrackDocumentStatus && documentId ? documentReferenceStates[documentId] : null
                const isDocumentReady = !shouldTrackDocumentStatus || (!!documentState && documentState.phase === "completed")
                const isDocumentFailed = shouldTrackDocumentStatus && !!documentState && documentState.phase === "failed"
                const isDocumentPending = shouldTrackDocumentStatus && !isDocumentReady && !isDocumentFailed
                const canOpen = !isDocumentReference || !shouldTrackDocumentStatus || isDocumentReady
                const progress = Math.max(8, Math.min(100, documentState?.progress ?? 8))

                return (
                  <button
                    key={`${reference.type}-${reference.id}-${index}`}
                    type="button"
                    onClick={() => {
                      if (!canOpen) return
                      emitReferenceSelection(reference)
                      closeChat()
                    }}
                    disabled={!canOpen}
                    className={`rounded-lg border px-2.5 py-1.5 text-[10px] sm:text-xs transition-all duration-200 ${
                      isDocumentReference ? "min-w-[220px] text-left" : ""
                    } ${
                      canOpen
                        ? "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:border-white/[0.15] hover:bg-white/[0.05] hover:text-foreground"
                        : "cursor-not-allowed border-white/[0.04] bg-white/[0.02] text-muted-foreground/70"
                    }`}
                    title={
                      isDocumentPending
                        ? `Dokument wird verarbeitet (${progress}%). Noch nicht anklickbar.`
                        : isDocumentFailed
                          ? "Dokumentverarbeitung fehlgeschlagen."
                          : "Im Wissensbereich öffnen"
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">
                        {reference.type === "chunk" && "Chunk"}
                        {reference.type === "fact" && "Fakt"}
                        {reference.type === "document" && "Dokument"}
                        {reference.type === "knowledge_base" && "KB"}
                        {" · "}
                        {reference.label}
                      </span>
                      {shouldTrackDocumentStatus && (
                        <span className="ml-auto flex items-center">
                          {isDocumentReady ? (
                            <Check className="size-3.5 text-pink-500" />
                          ) : isDocumentFailed ? (
                            <AlertCircle className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                          )}
                        </span>
                      )}
                    </div>
                    {isDocumentPending && (
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-pink-500/80 transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </button>
                )
              })()
            ))}
          </div>
        )}
      </div>
    )
  }

  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280
  const isMobileChat = variant === "floating"
  const top = isMobileChat ? 0 : (anchorRect?.top ?? 0)
  const left = isMobileChat ? 0 : (anchorRect?.left ?? 0)
  const width = isMobileChat ? viewportWidth : (anchorRect?.width ?? 560)
  const bottomSafeGap = isMobileChat ? 0 : (viewportWidth < 640 ? 64 : 80)
  const headerHeight = isMobileChat ? 0 : 36
  const panelHeight = isMobileChat ? viewportHeight : Math.max(260, viewportHeight - top - bottomSafeGap - headerHeight)
  const chatPanelWidth = Math.min(Math.round(width * 1.77), viewportWidth - 24) /* ~15% breiter (1.54 * 1.15 ≈ 1.77) */
  const chatPanelLeft = Math.max(12, Math.min(left - Math.round((chatPanelWidth - width) / 2), viewportWidth - chatPanelWidth - 12))
  const chatPanelOffset = chatPanelLeft - left

  const applyQuickAction = (prompt: string) => {
    setInput(prompt)
    if (!isRendered) {
      openChat()
    }
    const len = prompt.length
    window.setTimeout(() => {
      inputRef.current?.focus()
      if (inputRef.current) {
        inputRef.current.setSelectionRange(len, len)
      }
    }, 40)
  }

  return (
    <>
      {/* Global file inputs - always mounted so refs work in both trigger and portal */}
      <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_TYPES} className="hidden"
        onChange={e => { if (e.target.files) handleFileSelect(e.target.files); e.target.value = "" }} />
      <input id="agent-folder-input" type="file" multiple webkitdirectory="" className="hidden"
        onChange={e => { if (e.target.files) handleFileSelect(e.target.files); e.target.value = "" }} />

      {/* Floating Action Button for mobile variant */}
      {variant === "floating" && (
        <button
          ref={floatingBtnRef}
          type="button"
          onClick={() => { if (!isRendered) openChat(); else closeChat() }}
          className={`fixed bottom-5 right-5 z-[410] flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.1] bg-[#1e1e1e] shadow-lg shadow-black/40 transition-all duration-200 hover:scale-105 hover:border-white/20 active:scale-95 ${isRendered ? 'bg-white/10' : ''}`}
          aria-label="Agent Chat öffnen"
        >
          {isRendered ? (
            <X className="size-5 text-white/70" />
          ) : (
            <Sparkles className="size-5 text-pink-400/80" />
          )}
        </button>
      )}

      {variant === "inline" && <div ref={triggerRef} className="h-9 w-full">
        {!isRendered ? (
          <>
          <form
            onSubmit={handleSubmit}
            className="agent-input-glow relative flex h-9 w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-[#1a1a1a] px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onMouseDown={() => {
              if (!isRendered) {
                openChat()
              }
            }}
            aria-expanded={isRendered}
            aria-controls="knowledge-agent-dropdown"
          >
            <button
              type="button"
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                setIsKbPickerOpen(prev => !prev)
              }}
              className="inline-flex h-6 max-w-[180px] shrink-0 items-center gap-1 rounded-none border-0 bg-transparent px-2 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">{activeKnowledgeBaseName}</span>
              <ChevronDown className={`size-3 transition-transform ${isKbPickerOpen ? "rotate-180" : ""}`} />
            </button>
            {/* Inline attachment thumbnails */}
            {pendingAttachments.length > 0 && pendingAttachments.slice(0, 4).map(att => (
              <div key={att.id} className="relative shrink-0 group">
                {att.previewUrl ? (
                  <img src={att.previewUrl} alt={att.name} className="h-6 w-6 rounded border border-white/15 object-cover" />
                ) : (
                  <div className="flex h-6 items-center rounded border border-white/15 bg-white/[0.04] px-1" title={att.name}>
                    <FileText className="size-3 text-muted-foreground" />
                  </div>
                )}
                <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); removeAttachment(att.id) }}
                  className="absolute -right-0.5 -top-0.5 rounded-full bg-black/80 p-px opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="size-2 text-white" />
                </button>
              </div>
            ))}
            {pendingAttachments.length > 4 && (
              <span className="shrink-0 text-[9px] text-muted-foreground">+{pendingAttachments.length - 4}</span>
            )}
            <div className="relative h-full min-w-0 flex-1">
              <input
                ref={inputRef}
                value={input}
                onChange={event => setInput(event.target.value)}
                onFocus={() => {
                  if (!isRendered) {
                    openChat()
                  }
                }}
                placeholder=""
                aria-label={AGENT_PREVIEW_TEXT}
                className="h-full w-full bg-transparent text-left text-foreground outline-none"
              />
              {input.trim().length === 0 && pendingAttachments.length === 0 && (
                <span className="agent-preview-shimmer pointer-events-none absolute inset-0 flex items-center text-left text-xs">
                  {AGENT_PREVIEW_TEXT}
                </span>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); if (!isRendered) openChat() }}
                  className="flex shrink-0 items-center justify-center p-1 text-muted-foreground hover:text-foreground transition-colors" aria-label="Datei anhängen">
                  <Paperclip className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[500] min-w-[160px]" data-agent-dropdown="true">
                <DropdownMenuItem className="cursor-pointer text-xs" onClick={() => fileInputRef.current?.click()}>
                  <FileText className="mr-2 size-3" />Dateien anhängen
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-xs" onClick={() => document.getElementById("agent-folder-input")?.click()}>
                  <Search className="mr-2 size-3" />Ordner anhängen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="submit"
              className="flex shrink-0 items-center justify-center p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Senden"
            >
              <ArrowDown className="size-4" />
            </button>
            {isKbPickerOpen && knowledgeBaseOptions.length > 0 && (
              <div className="absolute left-2 top-8 z-20 w-[300px] overflow-hidden rounded-md border border-white/10 bg-background shadow-xl">
                <div className="max-h-64 overflow-y-auto p-1">
                  {knowledgeBaseOptions.map(option => {
                    const isActive = option.id === knowledgeBaseId
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setKnowledgeBaseId(option.id)
                          syncKnowledgeBaseSelection(option.id)
                          setIsKbPickerOpen(false)
                        }}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition-colors ${
                          isActive ? "bg-white/[0.06] text-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                        }`}
                      >
                        <span className="truncate">{option.name}</span>
                        {isActive && <Check className="ml-auto size-3.5 text-foreground/90" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </form>
          </>
        ) : (
          <div className="h-9 w-full rounded-lg border border-transparent" aria-hidden="true" />
        )}
      </div>}

      {isMounted &&
        isRendered &&
        anchorRect &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[420]">
            <div
              className={`absolute inset-0 bg-black/35 backdrop-blur-[3px] transition-opacity duration-300 ${
                isExpanded ? "opacity-100" : "opacity-0"
              }`}
            />
            <div
              ref={panelRef}
              className="pointer-events-auto absolute"
              style={{
                top: isMobileChat ? '0px' : `${top}px`,
                left: isMobileChat ? '0px' : `${left}px`,
                width: isMobileChat ? '100vw' : `${width}px`
              }}
            >
              {!isMobileChat && <form
                onSubmit={handleSubmit}
                className="agent-input-glow relative z-[2] flex h-9 w-full items-center gap-2 rounded-xl border border-white/[0.1] bg-[#1a1a1a] px-2 text-xs text-foreground shadow-lg shadow-black/30"
              >
                <button
                  type="button"
                  onClick={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    setIsKbPickerOpen(prev => !prev)
                  }}
                  className="inline-flex h-6 max-w-[180px] shrink-0 items-center gap-1 rounded-none border-0 bg-transparent px-2 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <span className="truncate">{activeKnowledgeBaseName}</span>
                  <ChevronDown className={`size-3 transition-transform ${isKbPickerOpen ? "rotate-180" : ""}`} />
                </button>
                {/* Inline attachment thumbnails */}
                {pendingAttachments.length > 0 && pendingAttachments.slice(0, 4).map(att => (
                  <div key={att.id} className="relative shrink-0 group">
                    {att.previewUrl ? (
                      <img src={att.previewUrl} alt={att.name} className="h-6 w-6 rounded border border-white/15 object-cover" />
                    ) : (
                      <div className="flex h-6 items-center rounded border border-white/15 bg-white/[0.04] px-1" title={att.name}>
                        <FileText className="size-3 text-muted-foreground" />
                      </div>
                    )}
                    <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); removeAttachment(att.id) }}
                      className="absolute -right-0.5 -top-0.5 rounded-full bg-black/80 p-px opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="size-2 text-white" />
                    </button>
                  </div>
                ))}
                {pendingAttachments.length > 4 && (
                  <span className="shrink-0 text-[9px] text-muted-foreground">+{pendingAttachments.length - 4}</span>
                )}
                <div className="relative h-full min-w-0 flex-1">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    placeholder=""
                    aria-label={AGENT_PREVIEW_TEXT}
                    className="h-full w-full bg-transparent text-left text-foreground outline-none"
                  />
                  {input.trim().length === 0 && pendingAttachments.length === 0 && (
                    <span className="agent-preview-shimmer pointer-events-none absolute inset-0 flex items-center text-left text-xs">
                      {AGENT_PREVIEW_TEXT}
                    </span>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation() }}
                      className="flex shrink-0 items-center justify-center p-1 text-muted-foreground hover:text-foreground transition-colors" aria-label="Datei anhängen">
                      <Paperclip className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[500] min-w-[160px]" data-agent-dropdown="true">
                    <DropdownMenuItem className="cursor-pointer text-xs" onClick={() => fileInputRef.current?.click()}>
                      <FileText className="mr-2 size-3" />Dateien anhängen
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer text-xs" onClick={() => document.getElementById("agent-folder-input")?.click()}>
                      <Search className="mr-2 size-3" />Ordner anhängen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="flex shrink-0 items-center justify-center p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  aria-label="Senden"
                >
                  {isUploading ? <Loader2 className="size-4 animate-spin" /> : <ArrowDown className="size-4" />}
                </button>
                {isKbPickerOpen && knowledgeBaseOptions.length > 0 && (
                  <div className="absolute left-2 top-8 z-20 w-[300px] overflow-hidden rounded-md border border-white/10 bg-background shadow-xl">
                    <div className="max-h-64 overflow-y-auto p-1">
                      {knowledgeBaseOptions.map(option => {
                        const isActive = option.id === knowledgeBaseId
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              setKnowledgeBaseId(option.id)
                              syncKnowledgeBaseSelection(option.id)
                              setIsKbPickerOpen(false)
                            }}
                            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition-colors ${
                              isActive
                                ? "bg-white/[0.06] text-foreground"
                                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                            }`}
                          >
                            <span className="truncate">{option.name}</span>
                            {isActive && <Check className="ml-auto size-3.5 text-foreground/90" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </form>}

              <div
                id="knowledge-agent-dropdown"
                className={`${isMobileChat ? '' : 'agent-panel-border agent-panel-glow'} origin-top overflow-hidden ${isMobileChat ? 'rounded-none' : 'rounded-[16px]'} border ${isMobileChat ? 'border-transparent' : 'border-white/[0.08]'} ${isMobileChat ? 'bg-[#1a1a1a]' : 'agent-glass'} transition-[max-height,opacity,transform] duration-300 ${
                  isExpanded ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
                }`}
                style={{
                  width: isMobileChat ? '100vw' : `${chatPanelWidth}px`,
                  marginLeft: isMobileChat ? '0' : `${chatPanelOffset}px`,
                  marginTop: isMobileChat ? '0' : "6px",
                  maxHeight: isExpanded ? (isMobileChat ? '100vh' : `${panelHeight}px`) : "0px",
                  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)"
                }}
              >
                <div className="flex flex-col bg-[#1a1a1a]" style={{ height: `${panelHeight}px` }}>
                  {/* Header-Leiste: Chat-Tabs, Neuer Chat, Historie, Menü */}
                  <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] bg-[#1a1a1a] px-2 py-1.5">
                    <div
                      ref={tabsScrollRef}
                      className="custom-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden"
                    >
                      <button
                        type="button"
                        onClick={startNewChat}
                        className={`shrink-0 translate-y-[3px] rounded-md px-2.5 py-1 text-[10px] leading-none transition-all duration-200 ${
                          !conversationId
                            ? "agent-tab-active text-foreground"
                            : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                        }`}
                      >
                        Neuer Chat
                      </button>
                      {recentConversations.map(conv => {
                        const label =
                          conv.title?.trim() ||
                          (conv.last_message_preview
                            ? conv.last_message_preview.slice(0, 28) + (conv.last_message_preview.length > 28 ? "…" : "")
                            : "Chat")
                        const isActive = conv.id === conversationId
                        return (
                          <button
                            key={conv.id}
                            type="button"
                            onClick={() => {
                              if (conv.id === conversationId) return
                              loadConversationMessages(conv.id)
                            }}
                            disabled={loadingConversationId !== null}
                            className={`shrink-0 translate-y-[3px] rounded-md px-2.5 py-1 text-[10px] leading-none transition-all duration-200 ${
                              isActive
                                ? "agent-tab-active text-foreground"
                                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                            }`}
                            title={conv.last_message_preview || undefined}
                          >
                            {loadingConversationId === conv.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <span className="block max-w-[140px] truncate">{label}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex shrink-0 -translate-y-[3px] items-center gap-0.5">
                      <button
                        type="button"
                        onClick={startNewChat}
                        className="flex h-5 min-h-[20px] w-5 min-w-[20px] items-center justify-center rounded p-0 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                        title="Neuer Chat"
                      >
                        <Plus className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryOpen(prev => !prev)}
                        className={`flex h-5 min-h-[20px] w-5 min-w-[20px] items-center justify-center rounded p-0 transition-colors ${
                          historyOpen ? "bg-white/10 text-foreground" : "text-muted-foreground bg-white/[0.04] hover:bg-white/[0.06] hover:text-foreground"
                        }`}
                        title="Chat-Verlauf"
                      >
                        <History className="size-3.5" />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-5 min-h-[20px] w-5 min-w-[20px] items-center justify-center rounded p-0 text-muted-foreground bg-white/[0.04] hover:bg-white/[0.06] hover:text-foreground"
                            title="Optionen"
                          >
                            <MoreVertical className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="z-[500] min-w-[148px] !text-[11px]"
                        data-agent-dropdown="true"
                      >
                        <DropdownMenuItem
                          className="!text-[11px] cursor-pointer"
                          onClick={() => {
                            loadRecentConversations()
                          }}
                        >
                          Verlauf aktualisieren
                        </DropdownMenuItem>
                        {conversationId && (
                          <DropdownMenuItem
                            className="!text-[11px] cursor-pointer text-muted-foreground focus:text-foreground"
                            onClick={async () => {
                              if (!conversationId) return
                              try {
                                await supabase.from("agent_conversations").delete().eq("id", conversationId)
                                loadRecentConversations()
                                startNewChat()
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            Diesen Chat löschen
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                      <button
                        type="button"
                        onClick={() => {
                          inputRef.current?.blur()
                          closeChat()
                        }}
                        className="flex h-5 min-h-[20px] w-5 min-w-[20px] items-center justify-center rounded p-0 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                        title="Chat schließen"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div ref={chatScrollRef} className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-8 pb-5 pt-5 sm:px-12 md:px-20 lg:px-28">
                    {isThinking && (
                      <div className="mx-auto flex w-full max-w-[715px] justify-start agent-message-in">
                        <div className="w-full rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-3 sm:p-4 space-y-2.5 backdrop-blur-sm">
                          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <span className="agent-thinking-dot inline-block size-1.5 rounded-full bg-pink-400/60" />
                              <span className="agent-thinking-dot inline-block size-1.5 rounded-full bg-pink-400/60" />
                              <span className="agent-thinking-dot inline-block size-1.5 rounded-full bg-pink-400/60" />
                            </div>
                            <span className="agent-working-shimmer">Agent arbeitet...</span>
                          </div>
                          {toolActivities.length > 0 && (
                            <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground/90">
                              {toolActivities.map(activity => (
                                <span key={activity.id} className={`inline-flex items-center gap-1 truncate max-w-[200px] ${activity.status === "running" ? "agent-tool-pulse" : ""}`}>
                                  {activity.status === "running" && <span className="inline-block size-1 rounded-full bg-pink-400" />}
                                  {activity.label}
                                  {activity.status === "done" ? " ✓" : activity.status === "error" ? " ✗" : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {renderedMessages.map((message, renderedIndex) => {
                      const originalIndex = messages.length - 1 - renderedIndex
                      const isEditingThisMessage = editingMessageId === message.id
                      return (
                      <div key={message.id} className={`agent-message-in ${message.role === "user" ? "relative w-full py-2 text-left" : "mx-auto w-full max-w-[715px] text-left"}`}>
                        {message.role === "user" ? (
                          <div className="relative w-full py-1">
                            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
                              <div className="h-[1px] w-full agent-user-line" />
                            </div>
                            <div className="relative z-10 mx-auto w-full max-w-[715px] rounded-xl border border-white/[0.08] bg-gradient-to-br from-[#1e1e1e] to-[#1a1a1a] p-2.5 sm:p-3 shadow-lg shadow-black/20">
                              {!isEditingThisMessage && (
                                <button
                                  type="button"
                                  onClick={() => startEditingMessage(message)}
                                  disabled={isThinking || isRegeneratingFromEdit}
                                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-muted-foreground transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label="Nachricht bearbeiten"
                                  title="Nachricht bearbeiten"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                              )}
                              {message.attachments && message.attachments.length > 0 && (
                                <div className={`mb-2 flex flex-wrap gap-1.5 ${isEditingThisMessage ? "" : "pr-8"}`}>
                                  {message.attachments.map((att, ai) => (
                                    att.type.startsWith("image/") ? (
                                      <img key={`att-${ai}`} src={att.url} alt={att.name}
                                        className="h-16 w-16 rounded-md border border-white/10 object-cover cursor-pointer hover:opacity-80"
                                        onClick={() => window.open(att.url, "_blank")} loading="lazy" />
                                    ) : (
                                      <a key={`att-${ai}`} href={att.url} target="_blank" rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                                        <FileText className="size-3 shrink-0" />
                                        <span className="max-w-[120px] truncate">{att.name}</span>
                                        <span className="text-[9px]">({(att.size / 1024).toFixed(0)} KB)</span>
                                      </a>
                                    )
                                  ))}
                                </div>
                              )}
                              {isEditingThisMessage ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editingMessageText}
                                    onChange={e => setEditingMessageText(e.target.value)}
                                    className="min-h-[82px] w-full resize-y rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-foreground outline-none focus:border-pink-400/40 transition-colors"
                                  />
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={cancelEditingMessage}
                                      disabled={isThinking || isRegeneratingFromEdit}
                                      className="rounded-md border border-white/15 bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      Abbrechen
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => regenerateFromEditedMessage(message, originalIndex)}
                                      disabled={isThinking || isRegeneratingFromEdit || compact(editingMessageText).length === 0}
                                      className="rounded-md border border-pink-400/45 bg-pink-500/10 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-pink-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      Neu senden
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="pr-8 text-[13px] leading-[1.7] text-white/80">
                                  <MarkdownMessage content={message.content} />
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="w-full text-left">
                            {renderAssistantBody(message)}
                          </div>
                        )}
                      </div>
                      )
                    })}

                    {messages.length === 0 && !isThinking && (
                      <div className="mx-auto w-full max-w-[715px] text-left">
                        <p className="text-[11.5px] sm:text-xs text-muted-foreground">
                          Starte mit einer Aufgabe, z. B. "Suche nach Zahlungsbedingungen".
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-white/[0.06] bg-[#1a1a1a] px-3 py-2.5">
                    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                      {QUICK_ACTIONS.map(action => {
                        const Icon = action.icon
                        return (
                          <button
                            key={action.id}
                            type="button"
                            onClick={() => applyQuickAction(action.prompt)}
                            className="agent-quick-action inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-muted-foreground"
                          >
                            <Icon className="size-3" />
                            <span>{action.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {/* Mobile input bar inside panel */}
                  {isMobileChat && (
                    <div className="shrink-0 border-t border-white/[0.06] bg-[#1a1a1a] px-3 py-2.5">
                      <form onSubmit={handleSubmit} className="agent-input-glow flex h-10 w-full items-center gap-2 rounded-xl border border-white/[0.1] bg-[#1e1e1e] px-3">
                        <input
                          ref={inputRef}
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          placeholder="Nachricht eingeben..."
                          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-white/80 placeholder:text-white/30 outline-none"
                        />
                        <button type="submit" className="flex shrink-0 items-center justify-center p-1 text-muted-foreground hover:text-foreground transition-colors" aria-label="Senden">
                          <ArrowDown className="size-4" />
                        </button>
                      </form>
                    </div>
                  )}
                    </div>
                    {/* History Sidebar */}
                    <div
                      className={`flex shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-[#1a1a1a] transition-all duration-300 ease-out ${
                        historyOpen ? "w-[280px]" : "w-0 border-l-0"
                      }`}
                    >
                      {historyOpen && (
                        <>
                          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-2">
                            <span className="text-[11px] font-medium text-foreground">Chat-Verlauf</span>
                            <button
                              type="button"
                              onClick={() => {
                                cancelRenameConversation()
                                setHistoryOpen(false)
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded p-0 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                              title="Schließen"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
                            {recentConversations.length === 0 ? (
                              <p className="px-3 py-4 text-[11px] text-muted-foreground">Noch keine Chats</p>
                            ) : (
                              recentConversations.map(conv => {
                                const label =
                                  conv.title?.trim() ||
                                  (conv.last_message_preview
                                    ? conv.last_message_preview.slice(0, 50) + (conv.last_message_preview.length > 50 ? "…" : "")
                                    : "Chat")
                                return (
                                  <div key={conv.id} className="group flex items-center gap-1 px-2 py-1">
                                    {editingConvId === conv.id ? (
                                      <input
                                        ref={renameInputRef}
                                        value={editingTitle}
                                        onChange={e => setEditingTitle(e.target.value)}
                                        onKeyDown={e => {
                                          if (e.key === "Enter") {
                                            e.preventDefault()
                                            saveRenameConversation()
                                          }
                                          if (e.key === "Escape") {
                                            e.preventDefault()
                                            cancelRenameConversation()
                                          }
                                        }}
                                        onClick={e => e.stopPropagation()}
                                        className="min-w-0 flex-1 rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-foreground outline-none focus:border-white/40"
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          loadConversationMessages(conv.id)
                                          setHistoryOpen(false)
                                        }}
                                        disabled={loadingConversationId !== null}
                                        className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-[11px] transition-all duration-200 ${
                                          conv.id === conversationId
                                            ? "agent-tab-active text-foreground"
                                            : "text-muted-foreground agent-history-item hover:text-foreground"
                                        }`}
                                      >
                                        {loadingConversationId === conv.id ? (
                                          <span className="flex items-center gap-1">
                                            <Loader2 className="size-3.5 shrink-0 animate-spin" />
                                            <span className="truncate">{label}</span>
                                          </span>
                                        ) : (
                                          label
                                        )}
                                      </button>
                                    )}
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          type="button"
                                          className="flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/[0.06] hover:text-foreground data-[state=open]:opacity-100"
                                        >
                                          <MoreHorizontal className="size-3.5" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="z-[500] min-w-[148px] !text-[11px]">
                                        <DropdownMenuItem className="!text-[11px] cursor-pointer" onSelect={e => { e.preventDefault(); startRenameConversation(conv) }}>
                                          <Pencil className="mr-2 size-3" />
                                          Umbenennen
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="!text-[11px] cursor-pointer text-muted-foreground focus:text-foreground" onSelect={e => { e.preventDefault(); handleDeleteConversation(conv) }}>
                                          <Trash2 className="mr-2 size-3" />
                                          Löschen
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                )
                              })
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
