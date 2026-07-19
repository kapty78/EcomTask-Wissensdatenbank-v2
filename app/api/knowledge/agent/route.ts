import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"
import { streamScalewayKnowledgeAgent } from "@/lib/knowledge-agent/scaleway-stream"

import { Database } from "@/supabase/types"
import { env } from "@/lib/env"
import { verifyCrossAgentHmac, timingSafeEqualStrings } from "@/lib/cross-agent-auth"
import { generateEmbeddings } from "@/lib/knowledge-base/embedding"
import { KNOWLEDGE_AGENT_STATIC_PROMPT, buildKnowledgeAgentContextPrompt, buildKnowledgeAgentSystemPrompt } from "@/lib/knowledge-agent/system-prompt"
import { KNOWLEDGE_AGENT_TOOLS, KnowledgeAgentToolName } from "@/lib/knowledge-agent/tool-schema"
import { findOverlappingChunks } from "@/lib/knowledge-agent/chunk-overlap"
import { runChunkFactRegeneration } from "@/lib/knowledge-agent/fact-regeneration"
import { buildKbOverview } from "@/lib/knowledge-agent/kb-overview"
import { generateFragenprompt } from "@/lib/knowledge-agent/question-prompt"
import { processDocument } from "@/lib/cursor-documents/processing"

// Konsolidierungs-/Struktur-Läufe des Agenten überschreiten den Vercel-Default
// von 300s (Befund 2026-07-02: Lauf bei ~300s gekillt, Dedup-Zeile blieb
// in_progress, Orchestrator meldete fälschlich "keine Änderungen").
export const maxDuration = 800

type AgentHistoryMessage = {
  role: "assistant" | "user"
  content: string
}

type AgentAttachment = {
  url: string
  name: string
  type: string
  size: number
}

type AgentRequestBody = {
  message?: string
  knowledgeBaseId?: string | null
  conversationId?: string | null
  history?: AgentHistoryMessage[]
  stream?: boolean
  attachments?: AgentAttachment[]
  companyId?: string | null
  /** SOTA-Block 3 (Budget-Vertrag): Zeitbudget des Aufrufers (Orchestrator-
   *  Soft-Deadline minus Synthese-Reserve). Der Loop erzwingt VOR Ablauf eine
   *  Abschluss-Synthese, statt in den Plattform-Kill zu laufen. */
  budget?: { deadline_ms?: number }
}

type AgentToolActivity = {
  id: string
  tool: string
  label: string
  status: "running" | "done" | "error"
  error?: string
  details?: {
    lines?: string[]
    links?: Array<{ title: string; url: string }>
  }
}

/** WP-D1 (Contract v2): strukturierte Aenderung eines Schreib-Tools —
 *  Format gespiegelt aus Support AI shared/types.ts (EntityChange).
 *
 *  WP-B3 (2026-07-17): optionale Audit-Belege. Das Cockpit toleriert ihr Fehlen
 *  dauerhaft (es verifiziert KB-Aenderungen per Read-back gegen die DB) — sobald
 *  ein WDB-Tool eine audit_id/Content-Hashes liefert, werden sie hier
 *  durchgereicht und das Cockpit kann direkt bestaetigen statt nachzulesen.
 *
 *  Operation-Enum-Mapping (WDB ↔ Cockpit-EntityChange.operation):
 *    WDB "create" → "create", "delete" → "delete",
 *    WDB "update" → Cockpit "patch"/"replace" (der Read-back prueft nur den
 *    updated_at-Timestamp, ein 1:1-Mapping ist daher nicht noetig). */
type EntityChange = {
  entity_type: string
  entity_id: string
  operation: "create" | "update" | "delete"
  field_name?: string | null
  audit_id?: string | null
  content_hash_before?: string | null
  content_hash_after?: string | null
}

type AgentRunError = {
  tool: string
  code?: string
  message: string
}

type AgentRunResult = {
  message: string
  richContent: AgentRichContent | null
  toolActivities: AgentToolActivity[]
  activeKnowledgeBaseId: string | null
  conversationId: string | null
  /** WP-D1: Response-Contract v2 — ok ist false sobald ein Tool-Fehler auftrat. */
  contractVersion: 2
  ok: boolean
  summary: string
  changes: EntityChange[]
  errors: AgentRunError[]
}

/** Tools, deren NAME auf ein Schreib-Verb matcht, die aber KEINE Entitaet
 *  persistieren: `set_active_knowledge_base` ist eine Session-/Navigations-
 *  Aktion, `generate_question_prompt` ist ein reiner Vorschlag ohne Speicherung
 *  (Save passiert extern via Mail-Agent). Ohne diese Ausnahme meldet ein reiner
 *  Analyse-/Lese-Turn faelschlich "1 Aenderung durchgefuehrt" (Phantom-Change
 *  mit entity_id "unbekannt") und verschmutzt die "Durchgefuehrte Aenderungen"-
 *  Uebersicht des Orchestrators. */
const NON_PERSISTING_TOOLS = new Set(["set_active_knowledge_base", "generate_question_prompt"])

/** WP-D1: generischer Change-Extraktor — leitet aus Tool-Name (Operation)
 *  und Result-Feldern (IDs) die strukturierte Aenderung ab, statt alle
 *  ~50 Schreib-Tools einzeln anzufassen. Lese-Tools liefern null. */
function extractEntityChange(toolName: string, result: any): EntityChange | null {
  if (!result || typeof result !== "object") return null
  if (NON_PERSISTING_TOOLS.has(toolName)) return null
  const op: EntityChange["operation"] | null =
    /^(delete|remove)_/.test(toolName) ? "delete"
    : /^(create|add|import|upload|generate)_/.test(toolName) ? "create"
    : /^(update|edit|rename|move|merge|combine|set)_/.test(toolName) ? "update"
    : null
  if (!op) return null
  const candidates: Array<[string, any]> = [
    ["document", result.document?.id ?? result.document_id],
    ["chunk", result.chunk?.id ?? result.chunk_id],
    ["fact", result.fact?.id ?? result.fact_id],
    ["knowledge_base", result.knowledge_base?.id ?? result.knowledge_base_id],
    ["standard_answer", result.standard_answer?.id ?? result.standard_answer_id],
    [String(result.deleted?.type || "entity"), result.deleted?.id],
  ]
  // WP-B3: audit_id/Content-Hashes durchreichen, falls ein Tool sie liefert
  // (heute i.d.R. nicht — das Cockpit verifiziert dann per Read-back).
  const auditId =
    typeof result.audit_id === "string" ? result.audit_id
    : typeof result.chunk?.audit_id === "string" ? result.chunk.audit_id
    : typeof result.fact?.audit_id === "string" ? result.fact.audit_id
    : null
  const hashBefore = typeof result.content_hash_before === "string" ? result.content_hash_before : null
  const hashAfter = typeof result.content_hash_after === "string" ? result.content_hash_after : null
  const withAudit = (change: EntityChange): EntityChange => ({
    ...change,
    ...(auditId ? { audit_id: auditId } : {}),
    ...(hashBefore ? { content_hash_before: hashBefore } : {}),
    ...(hashAfter ? { content_hash_after: hashAfter } : {}),
  })

  for (const [type, id] of candidates) {
    if (typeof id === "string" && id.length > 0) {
      return withAudit({ entity_type: type, entity_id: id, operation: op })
    }
  }
  // Schreib-Tool ohne erkennbare ID: Aenderung trotzdem ausweisen,
  // damit ok/changes nie faelschlich leer wirken.
  if (result.success === true || result.ok === true) {
    return { entity_type: toolName.replace(/^(create|add|import|upload|generate|update|edit|rename|move|merge|combine|set|delete|remove)_/, ""), entity_id: "unbekannt", operation: op }
  }
  return null
}

type AgentStreamEventName = "context" | "tool_start" | "tool_done" | "tool_error" | "text_delta" | "assistant_done"
type AgentStreamEmitter = (event: AgentStreamEventName, payload: Record<string, any>) => void

type ToolExecutionResult = {
  result: any
  nextActiveKnowledgeBaseId?: string | null
  nextActiveKnowledgeBaseName?: string | null
  nextCompanyId?: string | null
}

type VisibleKnowledgeBase = {
  id: string
  name: string
  company_id: string | null
}

type ConversationResolution = {
  conversationId: string | null
  knowledgeBaseId: string | null
  companyId: string | null
}

type ToolExecutionRecord = {
  toolName: string
  args: any
  status: "done" | "error"
  result?: any
  error?: string
}

type AgentInteractiveOption = {
  id: string
  label: string
  description?: string
}

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
      selectionMode: "single" | "multiple" | "either_or"
      options: AgentInteractiveOption[]
      minSelections: number
      maxSelections: number
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
  blocks: AgentRichBlock[]
  references: AgentRichReference[]
}

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY
})
const AGENT_MODEL = env.KNOWLEDGE_AGENT_MODEL
const AUX_MODEL = env.KNOWLEDGE_AGENT_AUX_MODEL
let scalewayClient: OpenAI | null = null

function getScalewayClient(): OpenAI {
  if (scalewayClient) return scalewayClient
  if (!env.SCALEWAY_API_KEY) {
    throw new Error("SCALEWAY_API_KEY fehlt fuer den Wissensdatenbank-Agenten.")
  }
  scalewayClient = new OpenAI({
    apiKey: env.SCALEWAY_API_KEY,
    baseURL: env.SCALEWAY_BASE_URL,
  })
  return scalewayClient
}

const KNOWLEDGE_API_URL = env.KNOWLEDGE_API_URL
const KNOWLEDGE_API_KEY = env.KNOWLEDGE_API_KEY

function compact(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function clip(text: string, max = 280) {
  const normalized = compact(text)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}...`
}

async function emitKickoffTextFromModel(params: {
  emit: AgentStreamEmitter
  message: string
  attachmentCount: number
  signal?: AbortSignal
}) {
  const { emit, message, attachmentCount, signal } = params
  try {
    const kickoffStream = await getScalewayClient().chat.completions.create(
      {
        model: AGENT_MODEL,
        stream: true,
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content:
              "Schreibe genau eine sehr kurze Live-Startzeile auf Deutsch (max. 12 Woerter), was du jetzt tust. Keine Begruessung, keine Liste, kein Markdown-Heading."
          },
          {
            role: "user",
            content: `Anfrage: ${clip(message, 220)}${attachmentCount > 0 ? ` (mit ${attachmentCount} Anhang${attachmentCount > 1 ? "en" : ""})` : ""}`
          }
        ]
      },
      { signal }
    )

    let emitted = false
    for await (const chunk of kickoffStream) {
      const delta = chunk.choices?.[0]?.delta
      if (!delta?.content) continue
      emitted = true
      emit("text_delta", { text: delta.content })
    }

    if (emitted) {
      emit("text_delta", { text: "\n\n" })
    }
  } catch {
    // Best effort: if kickoff stream fails, main workflow continues.
  }
}

function parseArgs(rawArgs: string | undefined) {
  if (!rawArgs) return {}
  try {
    const parsed = JSON.parse(rawArgs)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function asString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Ungültiger Parameter: ${fieldName}`)
  }
  return value.trim()
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asLimit(value: unknown, fallback = 6, max = 20) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.round(value)))
}

function normalizeSearchQuery(rawQuery: string) {
  const normalizedWhitespace = rawQuery.replace(/\s+/g, " ").trim()
  const withoutOuterQuotes = normalizedWhitespace
    .replace(/^[`"'“”„«»]+/, "")
    .replace(/[`"'“”„«»]+$/, "")
    .trim()
  return withoutOuterQuotes.length > 0 ? withoutOuterQuotes : normalizedWhitespace
}

function isConfirmTrue(value: unknown) {
  if (value === true) return true
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return ["true", "1", "yes", "ja", "confirm", "confirmed"].includes(normalized)
  }
  return false
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function htmlToPlainText(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
  const withLineHints = withoutScripts
    .replace(/<(\/?(h1|h2|h3|h4|h5|h6|p|li|br|tr|div|section|article))[^>]*>/gi, "\n")
  const noTags = withLineHints.replace(/<[^>]+>/g, " ")
  return decodeHtmlEntities(noTags).replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim()
}

function getFileNameFromUrl(fileUrl: string) {
  try {
    const pathname = new URL(fileUrl).pathname
    const decoded = decodeURIComponent(pathname.split("/").pop() || "")
    return decoded.trim() || null
  } catch {
    return null
  }
}


function getFileExtension(fileName: string | null) {
  if (!fileName) return null
  const idx = fileName.lastIndexOf(".")
  if (idx <= 0 || idx === fileName.length - 1) return null
  return fileName.slice(idx).toLowerCase()
}

function guessMimeTypeFromExtension(ext: string | null) {
  switch (ext) {
    case ".pdf":
      return "application/pdf"
    case ".txt":
      return "text/plain"
    case ".md":
      return "text/markdown"
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case ".doc":
      return "application/msword"
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    default:
      return null
  }
}

function sanitizeFileName(name: string) {
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
  return sanitized || "upload.txt"
}

async function processDocumentFromText(params: {
  content: string
  title: string
  description: string
  userId: string
  companyId: string | null
  knowledgeBaseId: string
}) {
  const { content, title, description, userId, companyId, knowledgeBaseId } = params

  const createFile = (nameTitle: string) =>
    new File([content], sanitizeFileName(`${nameTitle}.txt`), {
      type: "text/plain"
    })

  let finalTitle = title
  try {
    const documentId = await processDocument(
      createFile(finalTitle),
      userId,
      finalTitle,
      description,
      companyId || undefined,
      knowledgeBaseId
    )
    return { documentId, finalTitle }
  } catch (error: any) {
    const msg = String(error?.message || "")
    if (!msg.includes("documents_title_user_unique")) {
      throw error
    }

    finalTitle = `${title} (${new Date().toISOString().slice(0, 16).replace("T", " ")})`
    const documentId = await processDocument(
      createFile(finalTitle),
      userId,
      finalTitle,
      description,
      companyId || undefined,
      knowledgeBaseId
    )
    return { documentId, finalTitle }
  }
}

function normalizeHistory(history: AgentHistoryMessage[] | undefined): AgentHistoryMessage[] {
  if (!Array.isArray(history)) return []
  return history
    .filter(item => item && (item.role === "assistant" || item.role === "user"))
    .map(item => ({ role: item.role, content: compact(String(item.content || "")) }))
    .filter(item => item.content.length > 0)
    .slice(-14)
}

function resolveKnowledgeBaseId(args: any, activeKnowledgeBaseId: string | null) {
  return asOptionalString(args?.knowledge_base_id) || activeKnowledgeBaseId
}

function requireKnowledgeBaseId(maybeId: string | null) {
  if (!maybeId) {
    throw new Error(
      'Keine aktive Wissensdatenbank gesetzt. Nutze zuerst "list_knowledge_bases" und dann "set_active_knowledge_base".'
    )
  }
  return maybeId
}

// Cross-tenant guard: every tool that accepts a kb_id from the LLM must
// verify that the KB actually belongs to the calling agent's company before
// touching any data. This matters specifically for the cross-agent path
// (X-Cross-Agent-Secret) where authClient = serviceClient bypasses RLS.
async function assertKbBelongsToCompany(
  client: any,
  kbId: string,
  defaultCompanyId: string | null,
  userId: string | null
): Promise<{ company_id: string | null; sharing: string | null }> {
  const { data: kb, error } = await client
    .from("knowledge_bases")
    .select("id, company_id, sharing, user_id")
    .eq("id", kbId)
    .maybeSingle()

  if (error || !kb) {
    throw new Error(`Wissensdatenbank ${kbId.slice(0, 8)} nicht gefunden oder nicht zugreifbar.`)
  }

  // Cross-agent mode: STRICT — kb must belong to the caller's company.
  if (defaultCompanyId) {
    if (kb.company_id !== defaultCompanyId) {
      throw new Error(
        `Zugriff verweigert: Wissensdatenbank ${kbId.slice(0, 8)} gehört nicht zur anfragenden Company.`
      )
    }
    return { company_id: kb.company_id, sharing: kb.sharing }
  }

  // User session mode: allow if owner OR public sharing.
  if (kb.sharing === "public") return { company_id: kb.company_id, sharing: kb.sharing }
  if (userId && kb.user_id === userId) return { company_id: kb.company_id, sharing: kb.sharing }
  // Otherwise let RLS speak: if a follow-up query fails, that's the right answer.
  return { company_id: kb.company_id, sharing: kb.sharing }
}

// Alt-Tools sind aus dem LLM-Schema entfernt (ersetzt durch search_kb_text),
// bleiben aber im Executor als Alias ausfuehrbar (History-Replays, alte Plaene).
type LegacyKnowledgeAgentToolName = "search_chunks_by_text" | "search_facts_by_text"

function buildToolLabel(toolName: string, args: any) {
  switch (toolName as KnowledgeAgentToolName | LegacyKnowledgeAgentToolName) {
    case "web_search":
      return `Websuche: "${clip(String(args?.query || ""), 70)}"`
    case "import_web_page":
      return `Webseite importieren: ${clip(String(args?.url || ""), 44)}`
    case "list_knowledge_bases":
      return "Wissensdatenbanken laden"
    case "set_active_knowledge_base":
      return `Aktive KB setzen: ${String(args?.knowledge_base_id || args?.knowledge_base_name || "").slice(0, 28)}`
    case "create_knowledge_base":
      return `KB erstellen: ${clip(String(args?.name || ""), 40)}`
    case "list_documents":
      return `Dokumente laden${args?.query ? `: ${clip(String(args.query), 40)}` : ""}`
    case "search_knowledge":
      return `Suche: "${clip(String(args?.query || ""), 70)}"`
    case "debug_knowledge_search":
      return `Diagnose-Suche: "${clip(String(args?.query || ""), 60)}"`
    case "search_chunks_by_text":
      return `Chunks per Text suchen: "${clip(String(args?.query || ""), 50)}"`
    case "search_facts_by_text":
      return `Fakten per Text suchen: "${clip(String(args?.query || ""), 50)}"`
    case "search_kb_text": {
      const queries = Array.isArray(args?.queries) ? args.queries.map((q: any) => String(q ?? "").trim()).filter(Boolean) : []
      return `Textsuche (${queries.length} Begriffe): ${clip(queries.map((q: string) => `"${q}"`).join(", "), 70)}`
    }
    case "get_chunk_details": {
      const batchIds = Array.isArray(args?.chunk_ids) ? args.chunk_ids.filter(Boolean) : []
      if (batchIds.length > 1) return `Chunks laden: ${batchIds.length} Stück`
      const singleId = String(args?.chunk_id || batchIds[0] || "")
      return `Chunk laden: ${singleId.slice(0, 8)}`
    }
    case "create_chunk":
      return `Chunk erstellen${args?.document_id ? ` für ${String(args.document_id).slice(0, 8)}` : ""}`
    case "add_fact_to_chunk":
      return `Fakt ergänzen in Chunk ${String(args?.chunk_id || "").slice(0, 8)}`
    case "rename_knowledge_base":
      return `KB umbenennen: ${clip(String(args?.new_name || ""), 36)}`
    case "rename_document":
      return `Dokument umbenennen: ${clip(String(args?.new_name || ""), 36)}`
    case "rename_source":
      return `Quelle umbenennen: ${clip(String(args?.new_name || ""), 36)}`
    case "update_chunk_content":
      return `Chunk-Inhalt ändern: ${String(args?.chunk_id || "").slice(0, 8)}`
    case "update_fact_content":
      return `Fakt ändern: ${String(args?.fact_id || "").slice(0, 8)}`
    case "delete_knowledge_base":
      return `KB löschen: ${String(args?.knowledge_base_id || "").slice(0, 8)}`
    case "delete_document":
      return `Dokument löschen${args?.document_id ? `: ${String(args?.document_id).slice(0, 8)}` : ""}`
    case "delete_source":
      return `Quelle löschen${args?.source_id ? `: ${String(args?.source_id).slice(0, 8)}` : ""}`
    case "delete_chunk":
      return `Chunk löschen: ${String(args?.chunk_id || "").slice(0, 8)}`
    case "delete_fact":
      return `Fakt löschen: ${String(args?.fact_id || "").slice(0, 8)}`
    case "regenerate_chunk_facts":
      return `Fakten neu generieren für Chunk ${String(args?.chunk_id || "").slice(0, 8)}`
    case "run_mismatch_analysis":
      return args?.batch_id
        ? `Mismatch-Finder fortsetzen: ${String(args?.batch_id).slice(0, 18)}`
        : "Mismatch-Finder starten"
    case "get_chunk_combine_suggestions":
      return "Combine-Vorschläge laden"
    case "execute_chunk_combine":
      return `Combine ausführen: ${String(args?.primary_chunk_id || "").slice(0, 8)}`
    case "upload_text_document":
      return `Text hochladen: ${clip(String(args?.title || ""), 40)}`
    case "upload_file_from_url":
      return `Datei-Import via URL: ${clip(String(args?.file_url || ""), 44)}`
    case "present_code_block":
      return `Code-Block erzeugen${args?.language ? ` (${String(args.language).slice(0, 12)})` : ""}`
    case "present_table":
      return `Tabellenansicht erzeugen${args?.title ? `: ${clip(String(args.title), 24)}` : ""}`
    case "present_interactive_choices":
      return `Interaktive Auswahl: ${clip(String(args?.prompt || args?.title || ""), 52)}`
    case "present_image":
      return `Bildkarte erzeugen${args?.title ? `: ${clip(String(args.title), 24)}` : ""}`
    case "upload_attachment_to_kb":
      return `Anhang hochladen: ${clip(String(args?.title || args?.attachment_url || ""), 44)}`
    case "analyze_attachment":
      return `Anhang analysieren: ${clip(String(args?.attachment_name || args?.attachment_url || ""), 44)}`
    case "verify_fact_findability":
      return `Auffindbarkeit prüfen: "${clip(String(args?.reference_question || ""), 52)}"`
    case "get_knowledge_overview":
      return "KB-Überblick laden"
    case "generate_question_prompt":
      return "Fragenprompt-Vorschlag erzeugen"
    default:
      return `Tool ausführen: ${toolName}`
  }
}

function asStringCell(value: unknown, max = 220) {
  return clip(String(value ?? ""), max)
}

function asStringArray(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map(item => String(item ?? "").trim())
    .filter(item => item.length > 0)
}

function asChoiceOptions(value: unknown, maxItems = 12): AgentInteractiveOption[] {
  if (!Array.isArray(value)) return []

  const options: AgentInteractiveOption[] = []
  const usedIds = new Set<string>()

  for (const item of value.slice(0, maxItems)) {
    let label = ""
    let description: string | undefined
    let rawId: string | null = null

    if (typeof item === "string") {
      label = item.trim()
    } else if (item && typeof item === "object") {
      label = typeof (item as any).label === "string" ? String((item as any).label).trim() : ""
      description =
        typeof (item as any).description === "string" && String((item as any).description).trim()
          ? String((item as any).description).trim()
          : undefined
      rawId =
        typeof (item as any).id === "string" && String((item as any).id).trim()
          ? String((item as any).id).trim()
          : null
    }

    if (!label) continue

    const baseId =
      rawId ||
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) ||
      `option_${options.length + 1}`

    let nextId = baseId
    let suffix = 2
    while (usedIds.has(nextId)) {
      nextId = `${baseId}_${suffix}`
      suffix += 1
    }
    usedIds.add(nextId)

    options.push({
      id: nextId,
      label,
      description
    })
  }

  return options
}

function asTableRows(value: unknown, columnsCount: number, maxRows = 30): string[][] {
  if (!Array.isArray(value) || columnsCount <= 0) return []
  const rows: string[][] = []
  for (const rawRow of value.slice(0, maxRows)) {
    if (!Array.isArray(rawRow)) continue
    const row = rawRow
      .slice(0, columnsCount)
      .map(cell => asStringCell(cell, 180))
      .concat(Array(Math.max(0, columnsCount - rawRow.length)).fill(""))
    rows.push(row)
  }
  return rows
}

function asOptionalStringArray(value: unknown, maxItems = 100): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map(item => asOptionalString(item))
    .filter((item): item is string => Boolean(item))
}

async function callInternalKnowledgeApi<T>(
  baseUrl: string,
  path: string,
  payload: Record<string, any>
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Vertrauenswürdiger Server-zu-Server-Aufruf: die Ziel-Route erlaubt
      // damit den Zugriff ohne User-Session (siehe lib/kb-access.ts). Der
      // API_SECRET_KEY ist ausschließlich serverseitig verfügbar.
      ...(process.env.API_SECRET_KEY
        ? { "x-internal-api-key": process.env.API_SECRET_KEY }
        : {})
    },
    body: JSON.stringify(payload)
  })

  const contentType = response.headers.get("content-type") || ""
  const data = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() }

  if (!response.ok) {
    const errorMessage =
      typeof data?.error === "string"
        ? data.error
        : `Interne API ${path} fehlgeschlagen (${response.status})`
    throw new Error(errorMessage)
  }

  return data as T
}

function collectToolDerivedUi(params: {
  finalText: string
  records: ToolExecutionRecord[]
  activeKnowledgeBaseId: string | null
}): AgentRichContent {
  const { finalText, records, activeKnowledgeBaseId } = params

  const blocks: AgentRichBlock[] = []
  const references: AgentRichReference[] = []
  const referenceKeys = new Set<string>()

  const pushReference = (ref: AgentRichReference) => {
    const key = `${ref.type}:${ref.id}:${ref.knowledgeBaseId || ""}`
    if (referenceKeys.has(key)) return
    referenceKeys.add(key)
    references.push(ref)
  }
  const trimmedText = String(finalText || "").trim()

  const doneRecords = records.filter(record => record.status === "done")

  for (const record of doneRecords.slice(-8)) {
    const result = record.result || {}

    switch (record.toolName as KnowledgeAgentToolName) {
      case "list_knowledge_bases": {
        const knowledgeBases = Array.isArray(result?.knowledge_bases) ? result.knowledge_bases : []
        if (knowledgeBases.length > 0) {
          blocks.push({
            type: "table",
            title: "Wissensdatenbanken",
            columns: ["Name", "ID", "Freigabe"],
            rows: knowledgeBases.slice(0, 12).map((kb: any) => [
              asStringCell(kb?.name, 80),
              String(kb?.id || ""),
              asStringCell(kb?.sharing || "-", 24)
            ])
          })
          for (const kb of knowledgeBases.slice(0, 20)) {
            if (!kb?.id) continue
            pushReference({
              type: "knowledge_base",
              id: String(kb.id),
              label: asStringCell(kb?.name || kb.id, 80),
              knowledgeBaseId: String(kb.id)
            })
          }
        }
        break
      }

      case "create_knowledge_base": {
        const kbId =
          asOptionalString(result?.knowledge_base?.id) || asOptionalString(result?.knowledge_base_id)
        if (kbId) {
          pushReference({
            type: "knowledge_base",
            id: kbId,
            label: asStringCell(result?.knowledge_base?.name || `KB ${kbId.slice(0, 8)}`, 80),
            knowledgeBaseId: kbId
          })
        }
        break
      }

      case "list_documents": {
        const documents = Array.isArray(result?.documents) ? result.documents : []
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        if (documents.length > 0) {
          blocks.push({
            type: "table",
            title: "Dokumente",
            columns: ["Titel", "Typ", "ID"],
            rows: documents.slice(0, 12).map((doc: any) => [
              asStringCell(doc?.title || doc?.file_name || "Unbekannt", 90),
              asStringCell(doc?.file_type || "-", 24),
              String(doc?.id || "")
            ])
          })
          for (const doc of documents.slice(0, 20)) {
            if (!doc?.id) continue
            pushReference({
              type: "document",
              id: String(doc.id),
              label: asStringCell(doc?.title || doc?.file_name || doc.id, 80),
              checkProcessing: false,
              knowledgeBaseId: kbId,
              documentId: String(doc.id)
            })
          }
        }
        break
      }

      case "search_knowledge": {
        const searchResults = Array.isArray(result?.results) ? result.results : []
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        if (searchResults.length > 0) {
          const seen = new Set<string>()
          const uniqueResults = searchResults.filter((item: any) => {
            const content = String(item?.content ?? "").trim()
            const source = String(item?.source_name ?? "-").trim()
            const key = `${content}\0${source}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          blocks.push({
            type: "table",
            title: `Treffer für: ${asStringCell(result?.query || "", 60)}`,
            columns: ["Typ", "Vorschau", "Quelle"],
            rows: uniqueResults.slice(0, 8).map((item: any) => [
              asStringCell(item?.fact_type || "fact", 24),
              asStringCell(item?.content || "", 120),
              asStringCell(item?.source_name || "-", 48)
            ])
          })

          for (const item of uniqueResults.slice(0, 20)) {
            const chunkId = asOptionalString(item?.source_chunk)
            const factId = asOptionalString(item?.id)
            const sourceName = asOptionalString(item?.source_name)
            if (chunkId) {
              pushReference({
                type: "chunk",
                id: chunkId,
                label: sourceName ? `Chunk: ${sourceName}` : `Chunk ${chunkId.slice(0, 8)}`,
                knowledgeBaseId: kbId,
                chunkId
              })
            }
            if (factId) {
              pushReference({
                type: "fact",
                id: factId,
                label: asStringCell(item?.content || `Fakt ${factId.slice(0, 8)}`, 90),
                knowledgeBaseId: kbId,
                factId,
                chunkId: chunkId || null,
                sourceName: sourceName || null
              })
            }
          }
        }
        break
      }

      case "get_chunk_details": {
        const kbId = activeKnowledgeBaseId
        // Einzel-Format ({chunk, facts}) UND Batch-Format ({chunks: [...]})
        // auf dieselbe Entry-Liste normalisieren.
        const entries: any[] = Array.isArray(result?.chunks) && result.chunks.length > 0
          ? result.chunks
          : [result]
        for (const entry of entries) {
          const chunkId = asOptionalString(entry?.chunk?.id)
          if (chunkId) {
            pushReference({
              type: "chunk",
              id: chunkId,
              label: `Chunk ${chunkId.slice(0, 8)}`,
              knowledgeBaseId: kbId,
              chunkId,
              documentId: asOptionalString(entry?.chunk?.document_id)
            })
          }

          const facts = Array.isArray(entry?.facts) ? entry.facts : []
          if (facts.length > 0) {
            blocks.push({
              type: "table",
              title: chunkId ? `Chunk-Fakten (${chunkId.slice(0, 8)})` : "Chunk-Fakten",
              columns: ["Typ", "Inhalt", "ID"],
              rows: facts.slice(0, 10).map((fact: any) => [
                asStringCell(fact?.fact_type || "fact", 24),
                asStringCell(fact?.content || "", 110),
                asStringCell(fact?.id || "", 60)
              ])
            })

            for (const fact of facts.slice(0, 20)) {
              const factId = asOptionalString(fact?.id)
              if (!factId) continue
              pushReference({
                type: "fact",
                id: factId,
                label: asStringCell(fact?.content || `Fakt ${factId.slice(0, 8)}`, 90),
                knowledgeBaseId: kbId,
                factId,
                chunkId: chunkId || null
              })
            }
          }
        }
        break
      }

      case "create_chunk": {
        const chunkId = asOptionalString(result?.chunk?.id)
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        if (chunkId) {
          pushReference({
            type: "chunk",
            id: chunkId,
            label: `Neuer Chunk ${chunkId.slice(0, 8)}`,
            knowledgeBaseId: kbId,
            chunkId,
            documentId: asOptionalString(result?.chunk?.document_id)
          })
        }
        break
      }

      case "add_fact_to_chunk": {
        const factId = asOptionalString(result?.fact?.id)
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        const chunkId = asOptionalString(record?.args?.chunk_id)
        if (factId) {
          pushReference({
            type: "fact",
            id: factId,
            label: `Neuer Fakt ${factId.slice(0, 8)}`,
            knowledgeBaseId: kbId,
            factId,
            chunkId
          })
        }
        break
      }

      case "rename_knowledge_base": {
        const kbId = asOptionalString(result?.knowledge_base_id)
        if (kbId) {
          pushReference({
            type: "knowledge_base",
            id: kbId,
            label: asStringCell(result?.new_name || `KB ${kbId.slice(0, 8)}`, 80),
            knowledgeBaseId: kbId
          })
        }
        break
      }

      case "rename_document":
      case "rename_source": {
        const documentId = asOptionalString(result?.document?.id)
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        if (documentId) {
          pushReference({
            type: "document",
            id: documentId,
            label: asStringCell(result?.document?.title || `Dokument ${documentId.slice(0, 8)}`, 90),
            checkProcessing: false,
            knowledgeBaseId: kbId,
            documentId
          })
        }
        break
      }

      case "update_chunk_content": {
        const chunkId = asOptionalString(result?.chunk?.id)
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        if (chunkId) {
          pushReference({
            type: "chunk",
            id: chunkId,
            label: `Chunk ${chunkId.slice(0, 8)}`,
            knowledgeBaseId: kbId,
            chunkId,
            documentId: asOptionalString(result?.chunk?.document_id)
          })
        }
        break
      }

      case "update_fact_content": {
        const factId = asOptionalString(result?.fact?.id)
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        const chunkId = asOptionalString(result?.fact?.chunk_id)
        if (factId) {
          pushReference({
            type: "fact",
            id: factId,
            label: asStringCell(result?.fact?.preview || `Fakt ${factId.slice(0, 8)}`, 90),
            knowledgeBaseId: kbId,
            factId,
            chunkId
          })
        }
        break
      }

      case "upload_text_document": {
        const documentId = asOptionalString(result?.document?.id)
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        if (documentId) {
          pushReference({
            type: "document",
            id: documentId,
            label: asStringCell(result?.document?.title || `Dokument ${documentId.slice(0, 8)}`, 90),
            checkProcessing: true,
            knowledgeBaseId: kbId,
            documentId
          })
        }
        break
      }

      case "import_web_page": {
        const documentId = asOptionalString(result?.document?.id)
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        if (documentId) {
          pushReference({
            type: "document",
            id: documentId,
            label: asStringCell(result?.document?.title || `Dokument ${documentId.slice(0, 8)}`, 90),
            checkProcessing: true,
            knowledgeBaseId: kbId,
            documentId
          })
        }
        break
      }

      case "run_mismatch_analysis": {
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        const status = asOptionalString(result?.status)
        const progress =
          typeof result?.progress === "number" && Number.isFinite(result.progress)
            ? Math.max(0, Math.min(100, Math.round(result.progress)))
            : null
        const conflictGroups = Array.isArray(result?.conflictGroups) ? result.conflictGroups : []

        if (status || progress !== null) {
          const headerLine = [
            status ? `Status: ${status}` : null,
            progress !== null ? `Fortschritt: ${progress}%` : null,
            typeof result?.jobId === "string" ? `Job: ${result.jobId}` : null
          ]
            .filter(Boolean)
            .join(" · ")
          if (headerLine) {
            blocks.push({
              type: "text",
              text: headerLine
            })
          }
        }

        if (conflictGroups.length > 0) {
          blocks.push({
            type: "table",
            title: "Mismatch-Konflikte",
            columns: ["Thema", "Konflikte", "Score"],
            rows: conflictGroups.slice(0, 10).map((group: any) => [
              asStringCell(group?.topic || "Unbenannt", 70),
              String(Array.isArray(group?.conflicts) ? group.conflicts.length : 0),
              asStringCell(
                typeof group?.similarity === "number"
                  ? `${Math.round(group.similarity * 100)}%`
                  : "-",
                12
              )
            ])
          })

          for (const group of conflictGroups.slice(0, 8)) {
            const conflicts = Array.isArray(group?.conflicts) ? group.conflicts : []
            for (const conflict of conflicts.slice(0, 8)) {
              const factId = asOptionalString(conflict?.id)
              if (!factId) continue
              pushReference({
                type: "fact",
                id: factId,
                label: asStringCell(conflict?.content || `Fakt ${factId.slice(0, 8)}`, 90),
                knowledgeBaseId: kbId,
                factId
              })
            }
          }
        }
        break
      }

      case "verify_fact_findability": {
        const variants = Array.isArray(result?.variants) ? result.variants : []
        if (variants.length > 0) {
          blocks.push({
            type: "table",
            title: `Auffindbarkeit: ${result?.passed ? "✅ BESTANDEN" : "❌ NICHT BESTANDEN"} (${result?.passed_count || 0}/${result?.total_variants || 0})`,
            columns: ["Variante", "Suchanfrage", "Position", "Score", "Status"],
            rows: variants.slice(0, 6).map((v: any) => [
              asStringCell(v?.variant_type || "", 20),
              asStringCell(v?.query || "", 60),
              v?.best_match_position ? `#${v.best_match_position}` : "–",
              v?.best_match_score !== null && v?.best_match_score !== undefined
                ? `${Math.round(v.best_match_score * 100)}%`
                : "–",
              v?.found_in_top3 ? "✅" : v?.found_in_top5 ? "⚠️" : "❌"
            ])
          })
        }
        const recommendations = Array.isArray(result?.recommendations) ? result.recommendations : []
        if (recommendations.length > 0) {
          blocks.push({
            type: "text",
            text: `**Empfehlungen:**\n${recommendations.map((r: string) => `- ${r}`).join("\n")}`
          })
        }
        break
      }

      case "get_chunk_combine_suggestions": {
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : []
        if (suggestions.length > 0) {
          blocks.push({
            type: "table",
            title: "Combine-Vorschläge",
            columns: ["Thema", "Knoten", "Score"],
            rows: suggestions.slice(0, 12).map((suggestion: any) => [
              asStringCell(suggestion?.topic || "Unbenannt", 70),
              String(Array.isArray(suggestion?.nodes) ? suggestion.nodes.length : 0),
              asStringCell(
                typeof suggestion?.similarityScore === "number"
                  ? `${Math.round(suggestion.similarityScore * 100)}%`
                  : "-",
                12
              )
            ])
          })

          for (const suggestion of suggestions.slice(0, 8)) {
            const nodes = Array.isArray(suggestion?.nodes) ? suggestion.nodes : []
            for (const node of nodes.slice(0, 12)) {
              const chunkId = asOptionalString(node?.chunkId)
              if (chunkId) {
                pushReference({
                  type: "chunk",
                  id: chunkId,
                  label: asStringCell(node?.sourceName || `Chunk ${chunkId.slice(0, 8)}`, 90),
                  knowledgeBaseId: kbId,
                  chunkId,
                  documentId: asOptionalString(node?.documentId)
                })
              }

              const knowledgeItemIds = asOptionalStringArray(node?.knowledgeItemIds, 16)
              for (const factId of knowledgeItemIds) {
                pushReference({
                  type: "fact",
                  id: factId,
                  label: asStringCell(
                    `${node?.sourceName || "Eintrag"} · Fakt ${factId.slice(0, 8)}`,
                    90
                  ),
                  knowledgeBaseId: kbId,
                  factId,
                  chunkId: chunkId || null
                })
              }
            }
          }
        }
        break
      }

      case "execute_chunk_combine": {
        const kbId = asOptionalString(result?.knowledge_base_id) || activeKnowledgeBaseId
        const primaryChunkId = asOptionalString(result?.data?.primaryChunkId)
        const mergedChunkIds = asOptionalStringArray(result?.data?.mergedChunkIds, 50)
        const warnings = asOptionalStringArray(result?.data?.warnings, 20)

        if (primaryChunkId) {
          pushReference({
            type: "chunk",
            id: primaryChunkId,
            label: `Primary Chunk ${primaryChunkId.slice(0, 8)}`,
            knowledgeBaseId: kbId,
            chunkId: primaryChunkId
          })
        }

        if (primaryChunkId || mergedChunkIds.length > 0) {
          blocks.push({
            type: "table",
            title: "Combine-Ergebnis",
            columns: ["Primary", "Zusammengeführt", "Fakten-Regeneration"],
            rows: [[
              asStringCell(primaryChunkId || "-", 50),
              String(mergedChunkIds.length),
              result?.data?.regenerationTriggered ? "gestartet" : "nein"
            ]]
          })
        }

        if (warnings.length > 0) {
          blocks.push({
            type: "text",
            text: `Warnungen: ${warnings.join(" | ")}`
          })
        }
        break
      }

      case "web_search": {
        const summary = asOptionalString(result?.summary)
        if (summary) {
          blocks.push({
            type: "text",
            text: clip(summary, 1800)
          })
        }
        break
      }

      case "present_code_block": {
        const content = asOptionalString(result?.content)
        if (!content) break
        blocks.push({
          type: "code",
          title: asOptionalString(result?.title) || undefined,
          language: asOptionalString(result?.language) || undefined,
          content
        })
        break
      }

      case "present_table": {
        const columns = asStringArray(result?.columns, 12)
        const rows = asTableRows(result?.rows, columns.length, 40)
        if (columns.length === 0 || rows.length === 0) break
        blocks.push({
          type: "table",
          title: asOptionalString(result?.title) || undefined,
          columns,
          rows
        })
        break
      }

      case "present_interactive_choices": {
        const prompt = asOptionalString(result?.prompt)
        const options = asChoiceOptions(result?.options, 12)
        if (!prompt || options.length < 2) break

        const rawMode = asOptionalString(result?.selection_mode)?.toLowerCase()
        const selectionMode: "single" | "multiple" | "either_or" =
          rawMode === "multiple" ? "multiple" : rawMode === "either_or" ? "either_or" : "single"

        const fallbackMin = selectionMode === "multiple" ? 1 : 1
        const fallbackMax = selectionMode === "multiple" ? options.length : 1
        const minSelectionsRaw =
          typeof result?.min_selections === "number" && Number.isFinite(result.min_selections)
            ? Math.round(result.min_selections)
            : fallbackMin
        const maxSelectionsRaw =
          typeof result?.max_selections === "number" && Number.isFinite(result.max_selections)
            ? Math.round(result.max_selections)
            : fallbackMax

        const minSelections = Math.max(0, Math.min(options.length, minSelectionsRaw))
        const maxSelections = Math.max(minSelections || 1, Math.min(options.length, maxSelectionsRaw))

        blocks.push({
          type: "interactive_choices",
          title: asOptionalString(result?.title) || undefined,
          prompt,
          selectionMode,
          options,
          minSelections,
          maxSelections,
          submitLabel: asOptionalString(result?.submit_label) || undefined,
          responsePrefix: asOptionalString(result?.response_prefix) || undefined
        })
        break
      }

      case "present_image": {
        const url = asOptionalString(result?.image_url)
        if (!url || !/^https?:\/\//i.test(url)) break
        blocks.push({
          type: "image",
          title: asOptionalString(result?.title) || undefined,
          url,
          alt: asOptionalString(result?.alt) || undefined
        })
        break
      }

      default:
        break
    }
  }

  const limitedBlocks = blocks.slice(0, 14)
  const limitedReferences = references.slice(0, 30)

  if (trimmedText && (limitedBlocks.length > 0 || limitedReferences.length > 0)) {
    limitedBlocks.unshift({
      type: "text",
      text: trimmedText
    })
  }

  return {
    blocks: limitedBlocks,
    references: limitedReferences
  }
}

async function getAuthClient(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null

  if (bearerToken) {
    return createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        },
        global: {
          headers: {
            Authorization: `Bearer ${bearerToken}`
          }
        }
      }
    )
  }

  return createRouteHandlerClient<Database>({ cookies })
}

function normalizeSearchResults(payload: any, limit: number) {
  let raw: any[] = []

  if (Array.isArray(payload)) {
    if (
      payload.length === 1 &&
      payload[0] &&
      typeof payload[0] === "object" &&
      (Array.isArray(payload[0]?.data) || Array.isArray(payload[0]?.results) || Array.isArray(payload[0]?.items))
    ) {
      raw = Array.isArray(payload[0]?.data)
        ? payload[0].data
        : Array.isArray(payload[0]?.results)
          ? payload[0].results
          : Array.isArray(payload[0]?.items)
            ? payload[0].items
            : []
    } else {
      raw = payload
    }
  } else if (Array.isArray(payload?.results)) {
    raw = payload.results
  } else if (Array.isArray(payload?.data)) {
    raw = payload.data
  } else if (Array.isArray(payload?.items)) {
    raw = payload.items
  } else if (Array.isArray(payload?.json?.results)) {
    raw = payload.json.results
  } else if (Array.isArray(payload?.json?.data)) {
    raw = payload.json.data
  } else if (Array.isArray(payload?.json?.items)) {
    raw = payload.json.items
  }

  return raw.slice(0, limit).map((item: any) => ({
    id: item.id || item.fact_id || item.knowledge_item_id || null,
    knowledge_item_id: item.knowledge_item_id || item.id || item.fact_id || null,
    source_chunk: item.source_chunk || item.chunk_id || null,
    chunk_id: item.chunk_id || item.source_chunk || null,
    fact_type: item.fact_type || item.type || null,
    source_name: item.source_name || item.document_file_name || item.document_title || item.source || null,
    document_id: item.document_id || null,
    document_title: item.document_title || item.document_file_name || null,
    document_file_name: item.document_file_name || item.document_title || null,
    content: clip(
      String(
        item.content ||
          item.question ||
          item.knowledge_item_content ||
          item.pagecontent ||
          item.text ||
          item.answer ||
          ""
      ),
      500
    ),
    chunk_content: clip(String(item.chunk_content || ""), 1600),
    similarity: typeof item.similarity === "number" && Number.isFinite(item.similarity) ? item.similarity : null,
    created_at: item.created_at || null
  }))
}

async function loadDocumentsForList(params: {
  authClient: any
  knowledgeBaseId: string
  query: string | null
  limit: number
}) {
  const { authClient, knowledgeBaseId, query, limit } = params

  // documents hat im produktiven Schema kein knowledge_base_id.
  // Daher wird die KB-Zugehörigkeit über knowledge_items.document_id aufgelöst.
  const { data: kbItems, error: kbItemsError } = await authClient
    .from("knowledge_items")
    .select("document_id, source_name, created_at")
    .eq("knowledge_base_id", knowledgeBaseId)
    .not("document_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000)

  if (kbItemsError) {
    throw kbItemsError
  }

  const rows = Array.isArray(kbItems) ? kbItems : []
  const sourceNameByDocumentId = new Map<string, string>()
  const orderedDocumentIds: string[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const documentId = typeof row?.document_id === "string" ? row.document_id : null
    if (!documentId) continue
    if (!seen.has(documentId)) {
      seen.add(documentId)
      orderedDocumentIds.push(documentId)
    }
    if (typeof row?.source_name === "string" && row.source_name.trim().length > 0) {
      sourceNameByDocumentId.set(documentId, row.source_name.trim())
    }
  }

  if (orderedDocumentIds.length === 0) {
    return []
  }

  const { data: docsData, error: docsError } = await authClient
    .from("documents")
    .select("*")
    .in("id", orderedDocumentIds)

  if (docsError) {
    throw docsError
  }

  const docs = Array.isArray(docsData) ? docsData : []
  const loweredQuery = query ? query.toLowerCase() : null

  const normalized = docs
    .map((doc: any) => {
      const fallbackName = sourceNameByDocumentId.get(doc.id) || null
      const resolvedName = doc.title || doc.file_name || fallbackName || "Unbekannt"
      return {
        ...doc,
        __resolved_name: resolvedName
      }
    })
    .filter((doc: any) => {
      if (!loweredQuery) return true
      const haystack = `${String(doc.__resolved_name || "")} ${String(doc.file_name || "")}`.toLowerCase()
      return haystack.includes(loweredQuery)
    })
    .sort((a: any, b: any) => {
      const aTs = Date.parse(String(a.created_at || "")) || 0
      const bTs = Date.parse(String(b.created_at || "")) || 0
      return bTs - aTs
    })

  return normalized.slice(0, limit)
}

async function getDocumentKbRelationStatus(params: {
  authClient: any
  documentId: string
  knowledgeBaseId: string
}) {
  const { authClient, documentId, knowledgeBaseId } = params

  const { data: matchRows, error: matchError } = await authClient
    .from("knowledge_items")
    .select("id")
    .eq("document_id", documentId)
    .eq("knowledge_base_id", knowledgeBaseId)
    .limit(1)

  if (matchError) {
    throw matchError
  }

  if (Array.isArray(matchRows) && matchRows.length > 0) {
    return "matches" as const
  }

  const { data: anyRows, error: anyError } = await authClient
    .from("knowledge_items")
    .select("id")
    .eq("document_id", documentId)
    .not("knowledge_base_id", "is", null)
    .limit(1)

  if (anyError) {
    throw anyError
  }

  if (Array.isArray(anyRows) && anyRows.length > 0) {
    return "other" as const
  }

  return "unassigned" as const
}

async function resolveDocumentForKb(params: {
  authClient: any
  knowledgeBaseId: string
  documentId?: string | null
  documentTitle?: string | null
}) {
  const { authClient, knowledgeBaseId, documentId, documentTitle } = params
  let resolvedDocumentId = documentId || null

  if (!resolvedDocumentId && documentTitle) {
    const candidates = await loadDocumentsForList({
      authClient,
      knowledgeBaseId,
      query: documentTitle,
      limit: 5
    })

    if (!candidates || candidates.length === 0) {
      throw new Error("Kein passendes Dokument gefunden. Nutze list_documents zur Auswahl.")
    }

    if (candidates.length > 1) {
      throw new Error(
        `Mehrere Dokumente passen: ${candidates
          .map((d: any) => `${d.title || d.file_name} (${String(d.id).slice(0, 8)})`)
          .join(", ")}. Bitte document_id angeben.`
      )
    }

    resolvedDocumentId = candidates[0].id
  }

  if (!resolvedDocumentId) {
    throw new Error("document_id oder document_title ist erforderlich.")
  }

  const { data: document, error: docError } = await authClient
    .from("documents")
    .select("*")
    .eq("id", resolvedDocumentId)
    .single()

  if (docError || !document) {
    throw new Error("Dokument nicht gefunden oder nicht zugreifbar.")
  }

  const relationStatus = await getDocumentKbRelationStatus({
    authClient,
    documentId: resolvedDocumentId,
    knowledgeBaseId
  })

  if (relationStatus === "other") {
    throw new Error("Dokument gehört nicht zur aktiven Wissensdatenbank.")
  }

  return { document, documentId: resolvedDocumentId, relationStatus }
}

async function getChunkAndDocument(authClient: any, chunkId: string, knowledgeBaseId: string) {
  const { data: chunk, error: chunkError } = await authClient
    .from("document_chunks")
    .select("id, document_id, content, content_position")
    .eq("id", chunkId)
    .single()

  if (chunkError || !chunk) {
    throw new Error("Chunk nicht gefunden oder nicht zugreifbar.")
  }

  const { data: document, error: docError } = await authClient
    .from("documents")
    .select("*")
    .eq("id", chunk.document_id)
    .single()

  if (docError || !document) {
    throw new Error("Dokument zum Chunk nicht gefunden oder nicht zugreifbar.")
  }

  const { data: chunkMatchRows, error: chunkMatchError } = await authClient
    .from("knowledge_items")
    .select("id")
    .eq("source_chunk", chunk.id)
    .eq("knowledge_base_id", knowledgeBaseId)
    .limit(1)

  if (chunkMatchError) {
    throw new Error(`KB-Zuordnung für Chunk konnte nicht geprüft werden: ${chunkMatchError.message}`)
  }

  if (!Array.isArray(chunkMatchRows) || chunkMatchRows.length === 0) {
    const relationStatus = await getDocumentKbRelationStatus({
      authClient,
      documentId: chunk.document_id,
      knowledgeBaseId
    })

    if (relationStatus === "other") {
      throw new Error("Chunk gehört nicht zur aktiven Wissensdatenbank.")
    }
  }

  return { chunk, document }
}

async function getOrCreateConversation(params: {
  authClient: any
  serviceClient: any
  userId: string
  companyId: string | null
  knowledgeBaseId: string | null
  requestedConversationId: string | null
  /** Bei signierten Cross-Agent-Aufrufen ist die Company – nicht der zufaellig
   *  gewaehlte Profil-User – die stabile Mandantengrenze. */
  trustedCompanyId?: string | null
}): Promise<ConversationResolution> {
  const {
    authClient,
    serviceClient,
    userId,
    companyId,
    knowledgeBaseId,
    requestedConversationId,
    trustedCompanyId,
  } = params

  if (requestedConversationId) {
    if (trustedCompanyId) {
      const { data: existing, error } = await serviceClient
        .from("agent_conversations")
        .select("id, user_id, company_id, knowledge_base_id")
        .eq("id", requestedConversationId)
        .maybeSingle()

      if (error) {
        throw new Error(`Cross-Agent-Conversation konnte nicht geladen werden: ${error.message}`)
      }
      if (existing) {
        if (existing.company_id !== trustedCompanyId) {
          throw new Error("Cross-Agent-Conversation gehoert zu einer anderen Company.")
        }
        return {
          conversationId: existing.id as string,
          companyId: existing.company_id || null,
          knowledgeBaseId: existing.knowledge_base_id || null
        }
      }

      // Support AI und WDB besitzen getrennte Conversation-Tabellen. Dieselbe
      // ID darf deshalb bewusst in beiden Tabellen existieren und bildet den
      // stabilen Schluessel fuer History und aktive Wissensdatenbank.
      const { data: created, error: createError } = await serviceClient
        .from("agent_conversations")
        .insert({
          id: requestedConversationId,
          user_id: userId,
          company_id: trustedCompanyId,
          knowledge_base_id: knowledgeBaseId || null,
          status: "active"
        })
        .select("id")
        .single()

      if (createError || !created?.id) {
        // Ein paralleler Erstaufruf kann die Zeile zwischen Lesen und Insert
        // angelegt haben. In diesem Fall einmal mandantensicher nachlesen.
        const { data: raced } = await serviceClient
          .from("agent_conversations")
          .select("id, company_id, knowledge_base_id")
          .eq("id", requestedConversationId)
          .eq("company_id", trustedCompanyId)
          .maybeSingle()
        if (!raced) {
          throw new Error(`Cross-Agent-Conversation konnte nicht angelegt werden: ${createError?.message || "unbekannter Fehler"}`)
        }
        return {
          conversationId: raced.id as string,
          companyId: raced.company_id || null,
          knowledgeBaseId: raced.knowledge_base_id || null
        }
      }

      return {
        conversationId: created.id as string,
        companyId: trustedCompanyId,
        knowledgeBaseId: knowledgeBaseId || null
      }
    }

    try {
      const { data: existing, error } = await authClient
        .from("agent_conversations")
        .select("id, user_id, company_id, knowledge_base_id")
        .eq("id", requestedConversationId)
        .single()

      if (!error && existing?.user_id === userId) {
        return {
          conversationId: existing.id as string,
          companyId: existing.company_id || null,
          knowledgeBaseId: existing.knowledge_base_id || null
        }
      }
    } catch {
      // Fallback auf neue Conversation fuer regulaere User-Aufrufe
    }
  }

  try {
    const { data: created, error } = await serviceClient
      .from("agent_conversations")
      .insert({
        user_id: userId,
        company_id: companyId || null,
        knowledge_base_id: knowledgeBaseId || null,
        status: "active"
      })
      .select("id")
      .single()

    if (!error && created?.id) {
      return {
        conversationId: created.id as string,
        companyId: companyId || null,
        knowledgeBaseId: knowledgeBaseId || null
      }
    }
  } catch {
    // Tabelle ggf. noch nicht migriert
  }

  return {
    conversationId: null,
    companyId: companyId || null,
    knowledgeBaseId: knowledgeBaseId || null
  }
}

async function persistAgentMessage(params: {
  serviceClient: any
  conversationId: string | null
  userId: string
  companyId: string | null
  knowledgeBaseId: string | null
  role: "system" | "user" | "assistant" | "tool"
  content: string
  toolName?: string
  toolCallId?: string
  toolStatus?: "running" | "done" | "error"
  toolInput?: any
  toolOutput?: any
  metadata?: Record<string, any>
}) {
  const {
    serviceClient,
    conversationId,
    userId,
    companyId,
    knowledgeBaseId,
    role,
    content,
    toolName,
    toolCallId,
    toolStatus,
    toolInput,
    toolOutput,
    metadata
  } = params

  if (!conversationId) return

  try {
    await serviceClient.from("agent_messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      company_id: companyId || null,
      knowledge_base_id: knowledgeBaseId || null,
      role,
      content,
      tool_name: toolName || null,
      tool_call_id: toolCallId || null,
      tool_status: toolStatus || null,
      tool_input: typeof toolInput === "undefined" ? null : toolInput,
      tool_output: typeof toolOutput === "undefined" ? null : toolOutput,
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {})
    })
  } catch {
    // Persistence darf den Agenten nicht stoppen.
  }
}

async function syncConversationContext(params: {
  serviceClient: any
  conversationId: string | null
  companyId: string | null
  knowledgeBaseId: string | null
}) {
  const { serviceClient, conversationId, companyId, knowledgeBaseId } = params
  if (!conversationId) return

  try {
    await serviceClient
      .from("agent_conversations")
      .update({
        company_id: companyId || null,
        knowledge_base_id: knowledgeBaseId || null
      })
      .eq("id", conversationId)
  } catch {
    // Context-Sync darf den Agenten nicht stoppen.
  }
}

async function loadConversationHistory(params: {
  authClient: any
  conversationId: string | null
  limit?: number
}): Promise<AgentHistoryMessage[]> {
  const { authClient, conversationId, limit = 18 } = params
  if (!conversationId) return []

  try {
    const { data, error } = await authClient
      .from("agent_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(limit)

    if (error || !Array.isArray(data)) return []

    const normalized: AgentHistoryMessage[] = data
      .map((item: any) => ({
        role: (item.role === "assistant" ? "assistant" : "user") as AgentHistoryMessage["role"],
        content: compact(String(item.content || ""))
      }))
      .filter((item: AgentHistoryMessage) => item.content.length > 0)

    return normalized.reverse().slice(-14)
  } catch {
    return []
  }
}

// ── Mail-Agent Skills (feature 002) — proxy to the canonical skill service ──
// The Support-Backend (`app/routers/skills.py`) owns skill CRUD; the
// Knowledge-Agent never reimplements validation/limits, it only forwards.
const SUPPORT_BACKEND_URL = env.SUPPORT_BACKEND_URL
const SUPPORT_BACKEND_API_KEY = env.SUPPORT_BACKEND_API_KEY

async function callSkillsApi(opts: {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
  companyId: string
  userId?: string
  query?: Record<string, string | undefined>
  body?: any
}): Promise<any> {
  const url = new URL(`${SUPPORT_BACKEND_URL}${opts.path}`)
  url.searchParams.set("company_id", opts.companyId)
  if (opts.userId) url.searchParams.set("user_id", opts.userId)
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v != null) url.searchParams.set(k, v)
  }
  // WP-D4: Timeout + Graceful-Degradation. Ohne Timeout blockiert ein
  // haengendes Skills-Backend den gesamten Agent-Run bis zum Plattform-Limit.
  // Bei Timeout/Netzwerkfehler eine klare Meldung werfen (die per-Tool-
  // Fehlerbehandlung der Workflow-Schleife laesst den Run weiterlaufen).
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: opts.method,
      headers: { "Content-Type": "application/json", "X-API-Key": SUPPORT_BACKEND_API_KEY },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    const isTimeout = error instanceof Error && error.name === "AbortError"
    throw new Error(
      isTimeout
        ? "Skills derzeit nicht verfügbar (Zeitüberschreitung). Bitte später erneut versuchen."
        : "Skills derzeit nicht verfügbar (Verbindungsfehler). Bitte später erneut versuchen."
    )
  } finally {
    clearTimeout(timeout)
  }
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { detail: text }
  }
  if (!res.ok) {
    const msg = data?.reason || data?.detail || data?.error || `HTTP ${res.status}`
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg))
  }
  return data
}

/** Resolve the company's active Mail-Agent configuration id (skill target). */
async function resolveActiveMailConfigId(
  serviceClient: any,
  companyId: string | null,
): Promise<string | null> {
  if (!companyId) return null
  const { data } = await serviceClient
    .from("ai_agent_configurations")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id || null
}

// WP-D4: Tools, die eine kb_id aus Args/aktiver KB ableiten und KB-Daten
// berühren. Jedes hier gelistete Tool wird vom zentralen Guard in executeTool
// gegen die anfragende Company validiert. Pflege synchron zur Tool-Matrix
// (docs/TENANT-GUARD-MATRIX.md). NICHT gelistet (mit Begründung): list_/create_
// knowledge_bases (eigene company-scoped Query), present_* / web_search (kein
// KB-Datenzugriff), Skills-Tools (Skills-API mit Company-Scope).
const KB_SCOPED_TOOLS = new Set<string>([
  "import_web_page", "list_documents", "get_knowledge_overview",
  "generate_question_prompt", "search_knowledge", "debug_knowledge_search",
  "search_chunks_by_text", "search_facts_by_text", "search_kb_text", "get_chunk_details",
  "create_chunk", "add_fact_to_chunk", "rename_knowledge_base",
  "rename_document", "rename_source", "update_chunk_content",
  "update_fact_content", "delete_knowledge_base", "delete_document",
  "delete_source", "delete_chunk", "delete_fact", "regenerate_chunk_facts",
  "run_mismatch_analysis", "get_chunk_combine_suggestions",
  "execute_chunk_combine", "upload_text_document", "upload_file_from_url",
  "upload_attachment_to_kb", "verify_fact_findability", "analyze_attachment",
  "set_active_knowledge_base",
])

// Read-only-Tools ohne Seiteneffekte auf den Session-Kontext: duerfen innerhalb
// einer Runde PARALLEL laufen (Promise.all). Schreib-Tools und
// set_active_knowledge_base (mutiert currentKnowledgeBaseId) bleiben seriell
// und wirken als Barriere — nachfolgende Reads sehen den neuen Kontext.
const PARALLEL_SAFE_TOOLS = new Set<string>([
  "list_knowledge_bases", "list_documents", "search_knowledge",
  "debug_knowledge_search", "search_kb_text", "search_chunks_by_text",
  "search_facts_by_text", "get_chunk_details", "get_knowledge_overview",
  "get_chunk_combine_suggestions", "list_skills", "verify_fact_findability",
  "list_standard_answers", "get_standard_answer",
  "generate_question_prompt", "web_search", "analyze_attachment",
  "present_code_block", "present_table", "present_image", "present_interactive_choices",
])

// WP-D4 / SOTA-Block 3: Tool-Results in der LLM-History budgetieren.
// KRITISCHER Fix gegenueber dem alten blinden Byte-Slice: der zerschnitt
// get_chunk_details mitten im JSON — das Modell merge-te seine Aenderung in
// den GEKUERZTEN Text und schrieb ihn per update_chunk_content zurueck
// (stiller Datenverlust am Chunk-Ende), oder loopte auf der Suche nach dem
// "Trace" bis MAX_ROUNDS. Jetzt:
//   1. Detail-Tools, deren Vollergebnis fuer Read-Modify-Write GEBRAUCHT
//      wird, sind vom Clipping ausgenommen (grosszuegige Sicherheitsgrenze).
//   2. Alle anderen Ergebnisse werden STRUKTURELL gekuerzt (Array-Items
//      droppen + _omitted-Zaehler, lange Strings kappen) — das JSON bleibt
//      IMMER valide und traegt einen maschinenlesbaren Hinweis statt eines
//      Verweises auf einen fuer das Modell unerreichbaren "Trace".
const MAX_TOOL_RESULT_HISTORY_BYTES = 2048
/** Batch-Tools ersetzen VIELE Einzel-Calls — ihr Ergebnis darf entsprechend
 *  mehr History-Budget tragen (1 × 16KB statt 24 × 2KB). Vollstaendige Listen
 *  (list_documents/list_skills) ebenso: sonst clippt die History die Liste auf
 *  2KB weg, der Agent haelt sie fuer unvollstaendig und listet erneut (Runaway). */
const HISTORY_BUDGET_BY_TOOL: Record<string, number> = {
  search_kb_text: 16_000,
  list_documents: 16_000,
  list_skills: 24_000,
  list_standard_answers: 24_000,
}
/** Read-Modify-Write-Quellen: Vollergebnis noetig, sonst Datenverlust. */
const FULL_RESULT_TOOLS = new Set(["get_chunk_details"])
/** Absolute Sicherheitsgrenze auch fuer Detail-Tools (~16k Tokens). */
const FULL_RESULT_MAX_BYTES = 64_000
const CLIP_ARRAY_CAP = 8
const CLIP_STRING_CAP = 400

function clipValue(value: unknown, depth: number): unknown {
  if (value == null) return value
  if (typeof value === "string") {
    return value.length > CLIP_STRING_CAP
      ? value.slice(0, CLIP_STRING_CAP) + ` …[+${value.length - CLIP_STRING_CAP} Zeichen]`
      : value
  }
  if (typeof value !== "object") return value
  if (depth > 6) return "[verschachtelt gekuerzt]"
  if (Array.isArray(value)) {
    if (value.length <= CLIP_ARRAY_CAP) return value.map((v) => clipValue(v, depth + 1))
    return [
      ...value.slice(0, CLIP_ARRAY_CAP).map((v) => clipValue(v, depth + 1)),
      { _omitted: value.length - CLIP_ARRAY_CAP, hinweis: "weitere Eintraege weggelassen — bei Bedarf gezielter suchen/filtern" },
    ]
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = clipValue(v, depth + 1)
  return out
}

function clipToolResultForHistory(toolName: string, result: unknown): string {
  let json: string
  try {
    json = JSON.stringify(result ?? {})
  } catch {
    json = '"[nicht serialisierbar]"'
  }
  if (FULL_RESULT_TOOLS.has(toolName)) {
    if (json.length <= FULL_RESULT_MAX_BYTES) return json
    // Chunk jenseits der Sicherheitsgrenze: NIEMALS still kappen und ein
    // Read-Modify-Write darauf zulassen — explizit als unvollstaendig markieren.
    return JSON.stringify({
      _unvollstaendig: true,
      hinweis:
        "Chunk-Ergebnis > 64KB — Volltext hier NICHT vollstaendig. KEIN update_chunk_content auf Basis dieses Ergebnisses durchfuehren; Chunk zuerst in kleinere Chunks aufteilen.",
      auszug: json.slice(0, 8_000),
    })
  }
  const historyBudget = HISTORY_BUDGET_BY_TOOL[toolName] ?? MAX_TOOL_RESULT_HISTORY_BYTES
  if (json.length <= historyBudget) return json
  try {
    const compacted = JSON.stringify(clipValue(result ?? {}, 0))
    if (compacted.length <= historyBudget * 4) return compacted
    // Immer noch zu gross: nur Skalar-Felder + Array-Umfaenge behalten.
    const scalars: Record<string, unknown> = { _gekuerzt: true, hinweis: "Ergebnis zu gross — Kernfelder unten; bei Bedarf gezielter abfragen." }
    if (result && typeof result === "object" && !Array.isArray(result)) {
      for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
        if (v == null) continue
        if (typeof v === "string") scalars[k] = v.slice(0, 160)
        else if (typeof v === "number" || typeof v === "boolean") scalars[k] = v
        else if (Array.isArray(v)) scalars[k] = `[${v.length} Eintraege]`
        if (Object.keys(scalars).length >= 14) break
      }
    }
    return JSON.stringify(scalars)
  } catch {
    return JSON.stringify({ _gekuerzt: true, hinweis: "Ergebnis zu gross und nicht kompaktierbar." })
  }
}

// WP-D4 (Spiegel von WP-A2): Secret-artige Felder vor der Persistenz maskieren.
// Tool-Outputs werden in agent_messages.tool_output gespeichert — kein
// Passwort/Token/Key darf dort im Klartext landen.
const SECRET_KEY_RE = /(pass|secret|token|api[-_]?key|authorization|credential|bearer)/i
function redactSecretsDeep(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value
  if (Array.isArray(value)) return value.map((v) => redactSecretsDeep(v, depth + 1))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) && typeof v === "string" ? "[redacted]" : redactSecretsDeep(v, depth + 1)
    }
    return out
  }
  return value
}

async function executeTool(params: {
  toolName: string
  args: any
  authClient: any
  serviceClient: any
  userId: string
  activeKnowledgeBaseId: string | null
  defaultCompanyId: string | null
  internalApiBaseUrl: string
  attachments?: AgentAttachment[]
}) {
  const {
    toolName,
    args,
    authClient,
    serviceClient,
    userId,
    activeKnowledgeBaseId,
    defaultCompanyId,
    internalApiBaseUrl,
    attachments
  } = params

  // ── WP-D4: Zentraler Tenant-Scope-Guard ────────────────────────────────
  // resolveKnowledgeBaseId nimmt JEDE args.knowledge_base_id (Z.432). Im
  // Cross-Agent-Modus ist authClient = serviceClient → RLS umgangen. Deshalb
  // MUSS jedes Tool, das eine kb_id aus Args/aktiver KB ableitet, die KB
  // gegen die anfragende Company validieren (assertKbBelongsToCompany wirft
  // bei Fremd-Company, Z.467). Entitaeten (chunk/fact/document) sind ueber
  // ihre KB-Bindung transitiv abgedeckt (getChunkAndDocument /
  // resolveDocumentForKb / fact∈kb-Check), sobald die KB selbst validiert ist.
  // NEUE kb-gebundene Tools MUESSEN hier eingetragen werden (Matrix:
  // docs/TENANT-GUARD-MATRIX.md). Tools mit Sonder-Resolution (Name-Suche)
  // scopen zusaetzlich inline — siehe set_active_knowledge_base.
  if (KB_SCOPED_TOOLS.has(toolName)) {
    const kbForScope = asOptionalString(args?.knowledge_base_id) || activeKnowledgeBaseId
    // Fehlt eine KB ganz, wirft das Tool selbst die passende Meldung
    // (requireKnowledgeBaseId). Eine vorhandene KB IMMER validieren.
    if (kbForScope) {
      await assertKbBelongsToCompany(serviceClient, kbForScope, defaultCompanyId, userId)
    }
  }

  switch (toolName as KnowledgeAgentToolName | LegacyKnowledgeAgentToolName) {
    // ── Mail-Agent Skills (feature 002) ──────────────────────────────
    case "list_skills": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext — Skills nicht verfügbar.")
      // /api/skills paginiert (max 100/Seite, next_cursor). Frueher wurde nur die
      // erste Seite geholt → der Agent hielt die Liste fuer unvollstaendig und
      // suchte per query-Varianten weiter (Runaway, 20+ Calls, 4 Min). Jetzt:
      // vollstaendig durchpaginieren und ein authoritatives complete/total-Signal
      // liefern, damit der Agent nach EINEM Aufruf weiss, dass er alles hat.
      const items: any[] = []
      let cursor: string | undefined
      for (let page = 0; page < 50; page++) {
        const data = await callSkillsApi({
          method: "GET",
          path: "/api/skills",
          companyId: defaultCompanyId,
          query: { limit: "100", ...(cursor ? { cursor } : {}) },
        })
        const pageItems: any[] = Array.isArray(data?.items) ? data.items : []
        items.push(...pageItems)
        const next = typeof data?.next_cursor === "string" && data.next_cursor ? data.next_cursor : null
        if (!next || pageItems.length === 0) break
        cursor = next
      }
      const q = asOptionalString(args?.query)?.toLowerCase()
      const filtered = q
        ? items.filter((s: any) =>
            `${s.name} ${s.description} ${(s.tags || []).join(" ")}`.toLowerCase().includes(q),
          )
        : items
      return {
        result: {
          skills: filtered,
          count: filtered.length,
          total: items.length,
          complete: true, // vollstaendig durchpaginiert — das sind ALLE Skills
          ...(q
            ? {
                hinweis: `Auf "${q}" gefiltert (${filtered.length}/${items.length}). Ohne 'query' bekommst du in EINEM Aufruf alle Skills — nicht mit anderen Begriffen erneut auflisten.`,
              }
            : {}),
        },
      } as ToolExecutionResult
    }
    case "create_skill": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext — Skill kann nicht angelegt werden.")
      const name = asString(args?.name, "name")
      const description = asString(args?.description, "description")
      const body = asString(args?.body, "body")
      const tags = Array.isArray(args?.tags) ? args.tags.filter((t: any) => typeof t === "string") : []
      // Skill gehört (organisatorisch) zu einer Datenbank: explizit angegeben
      // oder die aktuell aktive Datenbank. Ohne aktive DB → firmenweit (null).
      const kbId = asOptionalString(args?.knowledge_base_id) || activeKnowledgeBaseId || null
      const payload: any = { name, description, body, tags }
      if (kbId) payload.knowledge_base_id = kbId
      // KEINE Auto-Zuweisung an einen Agenten: Anlegen passiert hier (unter der
      // Datenbank), das Freischalten pro Mail-Agent passiert in der SupportAI.
      const data = await callSkillsApi({
        method: "POST",
        path: "/api/skills",
        companyId: defaultCompanyId,
        userId,
        body: payload,
      })
      return {
        result: {
          created: true,
          skill: data?.skill,
          knowledge_base_id: kbId,
          scope: kbId ? "datenbank" : "firmenweit",
          next_step: "In der SupportAI-Konfiguration des Mail-Agenten freischalten (an/aus).",
          quality_check: data?.quality_check,
          token_warnings: data?.token_warnings,
        },
      } as ToolExecutionResult
    }
    case "update_skill": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext.")
      const skillId = asString(args?.skill_id, "skill_id")
      const patch: any = {}
      if (asOptionalString(args?.name)) patch.name = args.name
      if (asOptionalString(args?.description)) patch.description = args.description
      if (asOptionalString(args?.body)) patch.body = args.body
      if (Array.isArray(args?.tags)) patch.tags = args.tags.filter((t: any) => typeof t === "string")
      if (asOptionalString(args?.change_summary)) patch.change_summary = args.change_summary
      const data = await callSkillsApi({
        method: "PATCH",
        path: `/api/skills/${skillId}`,
        companyId: defaultCompanyId,
        userId,
        body: patch,
      })
      return { result: { updated: true, skill: data?.skill, token_warnings: data?.token_warnings } } as ToolExecutionResult
    }
    case "assign_skill": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext.")
      const skillId = asString(args?.skill_id, "skill_id")
      const mailConfigId = await resolveActiveMailConfigId(serviceClient, defaultCompanyId)
      if (!mailConfigId) throw new Error("Keine aktive Mail-Konfiguration gefunden, der die Skill zugewiesen werden könnte.")
      const data = await callSkillsApi({
        method: "POST",
        path: `/api/skills/${skillId}/assignments`,
        companyId: defaultCompanyId,
        userId,
        body: { agent_config_id: mailConfigId, enabled: true },
      })
      return { result: { assigned: true, assignment: data } } as ToolExecutionResult
    }
    // ── Standardantworten (Antwort-Vorlagen) — proxy auf denselben Skill-Service
    //    (kind='standard_answer' in agent_skills), gleiche Auth wie Skills. ──
    case "list_standard_answers": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext — Standardantworten nicht verfügbar.")
      // Gleiches Vollstaendigkeits-Prinzip wie list_skills/list_documents:
      // /api/standard-answers paginiert (max 100/Seite, next_cursor). Vollstaendig
      // durchpaginieren und ein authoritatives complete/total-Signal liefern, damit
      // der Agent nach EINEM Aufruf weiss, dass er alles hat (kein Re-List-Runaway).
      const items: any[] = []
      let cursor: string | undefined
      for (let page = 0; page < 50; page++) {
        const data = await callSkillsApi({
          method: "GET",
          path: "/api/standard-answers",
          companyId: defaultCompanyId,
          query: { limit: "100", ...(cursor ? { cursor } : {}) },
        })
        const pageItems: any[] = Array.isArray(data?.items) ? data.items : []
        items.push(...pageItems)
        const next = typeof data?.next_cursor === "string" && data.next_cursor ? data.next_cursor : null
        if (!next || pageItems.length === 0) break
        cursor = next
      }
      const q = asOptionalString(args?.query)?.toLowerCase()
      const filtered = q
        ? items.filter((s: any) =>
            `${s.name} ${s.description} ${(s.tags || []).join(" ")}`.toLowerCase().includes(q),
          )
        : items
      return {
        result: {
          standard_answers: filtered,
          count: filtered.length,
          total: items.length,
          complete: true, // vollstaendig durchpaginiert — das sind ALLE Standardantworten
          ...(q
            ? {
                hinweis: `Auf "${q}" gefiltert (${filtered.length}/${items.length}). Ohne 'query' bekommst du in EINEM Aufruf alle Standardantworten — nicht mit anderen Begriffen erneut auflisten.`,
              }
            : {}),
        },
      } as ToolExecutionResult
    }
    case "get_standard_answer": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext.")
      const answerId = asString(args?.standard_answer_id, "standard_answer_id")
      const data = await callSkillsApi({
        method: "GET",
        path: `/api/standard-answers/${answerId}`,
        companyId: defaultCompanyId,
      })
      return { result: { standard_answer: data } } as ToolExecutionResult
    }
    case "create_standard_answer": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext — Standardantwort kann nicht angelegt werden.")
      const name = asString(args?.name, "name")
      const description = asString(args?.description, "description")
      const body = asString(args?.body, "body")
      const tags = Array.isArray(args?.tags) ? args.tags.filter((t: any) => typeof t === "string") : []
      // Nur den Nicht-Default explizit senden (Backend-Default ist "adaptive").
      const answerMode = asOptionalString(args?.answer_mode) === "verbatim" ? "verbatim" : undefined
      // Gehoert (organisatorisch) zu einer Datenbank: explizit oder aktive DB;
      // ohne aktive DB → firmenweit (null).
      const kbId = asOptionalString(args?.knowledge_base_id) || activeKnowledgeBaseId || null
      const payload: any = { name, description, body, tags }
      if (answerMode) payload.answer_mode = answerMode
      if (kbId) payload.knowledge_base_id = kbId
      const data = await callSkillsApi({
        method: "POST",
        path: "/api/standard-answers",
        companyId: defaultCompanyId,
        userId,
        body: payload,
      })
      return {
        result: {
          created: true,
          standard_answer: data?.standard_answer,
          knowledge_base_id: kbId,
          scope: kbId ? "datenbank" : "firmenweit",
          next_step: "In der SupportAI-Konfiguration des Mail-Agenten freischalten (an/aus).",
          quality_check: data?.quality_check,
          token_warnings: data?.token_warnings,
        },
      } as ToolExecutionResult
    }
    case "update_standard_answer": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext.")
      const answerId = asString(args?.standard_answer_id, "standard_answer_id")
      const patch: any = {}
      if (asOptionalString(args?.name)) patch.name = args.name
      if (asOptionalString(args?.description)) patch.description = args.description
      if (asOptionalString(args?.body)) patch.body = args.body
      if (Array.isArray(args?.tags)) patch.tags = args.tags.filter((t: any) => typeof t === "string")
      const mode = asOptionalString(args?.answer_mode)
      if (mode === "adaptive" || mode === "verbatim") patch.answer_mode = mode
      if (asOptionalString(args?.change_summary)) patch.change_summary = args.change_summary
      const data = await callSkillsApi({
        method: "PATCH",
        path: `/api/standard-answers/${answerId}`,
        companyId: defaultCompanyId,
        userId,
        body: patch,
      })
      return {
        result: {
          updated: true,
          standard_answer: data?.standard_answer,
          token_warnings: data?.token_warnings,
          quality_check: data?.quality_check,
        },
      } as ToolExecutionResult
    }
    case "delete_standard_answer": {
      if (!defaultCompanyId) throw new Error("Keine Firma im Kontext.")
      const answerId = asString(args?.standard_answer_id, "standard_answer_id")
      const force = args?.force === true
      await callSkillsApi({
        method: "DELETE",
        path: `/api/standard-answers/${answerId}`,
        companyId: defaultCompanyId,
        ...(force ? { query: { force: "true" } } : {}),
      })
      return { result: { deleted: { type: "standard_answer", id: answerId } } } as ToolExecutionResult
    }
    case "web_search": {
      const query = asString(args?.query, "query")
      const maxResults = asLimit(args?.max_results, 5, 10)
      const webSearchModel = process.env.KNOWLEDGE_AGENT_WEB_MODEL || AUX_MODEL

      try {
        const response: any = await (openai as any).responses.create({
          model: webSearchModel,
          tools: [{ type: "web_search" }],
          input: query
        })

        let text = ""
        const links: Array<{ title: string; url: string }> = []
        if (typeof response?.output_text === "string" && response.output_text.trim()) {
          text = response.output_text.trim()
        } else if (Array.isArray(response?.output)) {
          for (const item of response.output) {
            if (item?.type === "message" && Array.isArray(item?.content)) {
              for (const part of item.content) {
                if (part?.type === "output_text" && typeof part?.text === "string") {
                  text += `${part.text}\n`
                }
              }
            }
          }
          text = text.trim()
        }

        if (Array.isArray(response?.output)) {
          for (const item of response.output) {
            if (item?.type === "message" && Array.isArray(item?.content)) {
              for (const part of item.content) {
                const annotations = Array.isArray(part?.annotations) ? part.annotations : []
                for (const annotation of annotations) {
                  const url = typeof annotation?.url === "string" ? annotation.url : null
                  if (!url) continue
                  const title =
                    (typeof annotation?.title === "string" && annotation.title.trim()) ||
                    (typeof annotation?.source === "string" && annotation.source.trim()) ||
                    url
                  if (!links.find(link => link.url === url)) {
                    links.push({ title, url })
                  }
                }
              }
            }
          }
        }

        return {
          result: {
            query,
            max_results: maxResults,
            summary: text || "Keine Web-Ergebnisse verfügbar.",
            sources: links.slice(0, maxResults)
          }
        } as ToolExecutionResult
      } catch (error: any) {
        throw new Error(
          `Websuche fehlgeschlagen: ${error?.message || "Tool nicht verfügbar für dieses Modell/Setup."}`
        )
      }
    }

    case "import_web_page": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const url = asString(args?.url, "url")
      const manualTitle = asOptionalString(args?.title)
      const sourceName = asOptionalString(args?.source_name)

      if (!/^https?:\/\//i.test(url)) {
        throw new Error("url muss mit http:// oder https:// beginnen.")
      }

      const { data: kb, error: kbError } = await authClient
        .from("knowledge_bases")
        .select("id, name, company_id")
        .eq("id", resolvedKbId)
        .single()

      if (kbError || !kb) {
        throw new Error("Wissensdatenbank nicht gefunden oder keine Berechtigung.")
      }

      const pageResponse = await fetch(url, {
        headers: {
          "User-Agent": "EcomTask-Agent/1.0 (+knowledge-import)"
        }
      })
      if (!pageResponse.ok) {
        throw new Error(`Webseite konnte nicht geladen werden (${pageResponse.status}).`)
      }

      const contentType = (pageResponse.headers.get("content-type") || "").toLowerCase()
      const raw = await pageResponse.text()
      const extractedText = contentType.includes("html") ? htmlToPlainText(raw) : raw.trim()

      if (extractedText.length < 120) {
        throw new Error("Zu wenig verwertbarer Webseiteninhalt gefunden. Bitte andere URL wählen.")
      }

      const parsedHost = (() => {
        try {
          return new URL(url).hostname
        } catch {
          return "web"
        }
      })()

      const title = manualTitle || `Web Import: ${parsedHost}`
      const normalizedContent = extractedText.slice(0, 120000)
      let processed: { documentId: string; finalTitle: string }
      try {
        processed = await processDocumentFromText({
          content: normalizedContent,
          title,
          description: `Webseiten-Import via Agent: ${url}`,
          userId,
          companyId: kb.company_id || defaultCompanyId || null,
          knowledgeBaseId: resolvedKbId
        })
      } catch (error: any) {
        throw new Error(`Webseiten-Import fehlgeschlagen: ${error?.message || "unbekannt"}`)
      }

      return {
        result: {
          success: true,
          queued: true,
          provider: "web_text_upload_pipeline",
          knowledge_base_id: resolvedKbId,
          document: {
            id: processed.documentId,
            title: processed.finalTitle
          },
          import_url: url,
          source_name: sourceName || parsedHost
        }
      } as ToolExecutionResult
    }

    case "list_knowledge_bases": {
      const limit = asLimit(args?.limit, 30, 100)

      // CRITICAL: Always scope to company when defaultCompanyId is set (especially cross-agent)
      let kbQuery = defaultCompanyId
        ? serviceClient
            .from("knowledge_bases")
            .select("id, name, description, sharing, company_id, updated_at")
            .eq("company_id", defaultCompanyId)
            .order("updated_at", { ascending: false })
            .limit(limit)
        : authClient
            .from("knowledge_bases")
            .select("id, name, description, sharing, company_id, updated_at")
            .order("updated_at", { ascending: false })
            .limit(limit)

      const { data, error } = await kbQuery

      if (error) {
        throw new Error(`Wissensdatenbanken konnten nicht geladen werden: ${error.message}`)
      }

      let resolvedData = Array.isArray(data) ? data : []

      // Fallback: falls Auth-RLS leer zurückgibt, versuche scoped Service-Query (Company/Public/Owner).
      if (resolvedData.length === 0 && !defaultCompanyId) {
        const fallbackOrParts = [`sharing.eq.public`, `user_id.eq.${userId}`]

        const { data: fallbackData, error: fallbackError } = await serviceClient
          .from("knowledge_bases")
          .select("id, name, description, sharing, company_id, updated_at")
          .or(fallbackOrParts.join(","))
          .order("updated_at", { ascending: false })
          .limit(limit)

        if (!fallbackError && Array.isArray(fallbackData)) {
          resolvedData = fallbackData
        }
      }

      return {
        result: {
          count: resolvedData.length,
          knowledge_bases: resolvedData.map((kb: any) => ({
            id: kb.id,
            name: kb.name,
            sharing: kb.sharing,
            company_id: kb.company_id || null,
            updated_at: kb.updated_at
          })),
          active_knowledge_base_id: activeKnowledgeBaseId
        }
      } as ToolExecutionResult
    }

    case "set_active_knowledge_base": {
      const byId = asOptionalString(args?.knowledge_base_id)
      const byName = asOptionalString(args?.knowledge_base_name)

      if (!byId && !byName) {
        throw new Error("knowledge_base_id oder knowledge_base_name ist erforderlich.")
      }

      if (byId) {
        const { data: kb, error } = await authClient
          .from("knowledge_bases")
          .select("id, name, company_id")
          .eq("id", byId)
          .single()

        if (error || !kb) {
          throw new Error("Wissensdatenbank nicht gefunden oder keine Berechtigung.")
        }

        return {
          result: {
            success: true,
            active_knowledge_base_id: kb.id,
            active_knowledge_base_name: kb.name
          },
          nextActiveKnowledgeBaseId: kb.id,
          nextActiveKnowledgeBaseName: kb.name,
          nextCompanyId: kb.company_id || defaultCompanyId || null
        } as ToolExecutionResult
      }

      const searchName = byName as string
      // WP-D4: Name-Suche scoped auf die Company. Im Cross-Agent-Modus
      // umgeht serviceClient die RLS — ohne diesen Filter fände die Suche
      // fremde KBs gleichen Namens (der zentrale Guard greift hier nicht,
      // weil keine knowledge_base_id in den Args steht).
      let candidateQuery = authClient
        .from("knowledge_bases")
        .select("id, name, company_id")
        .ilike("name", `%${searchName}%`)
      if (defaultCompanyId) {
        candidateQuery = candidateQuery.eq("company_id", defaultCompanyId)
      }
      const { data: candidates, error } = await candidateQuery
        .order("updated_at", { ascending: false })
        .limit(5)

      if (error) {
        throw new Error(`KB-Suche fehlgeschlagen: ${error.message}`)
      }

      if (!candidates || candidates.length === 0) {
        throw new Error(`Keine Wissensdatenbank passend zu "${searchName}" gefunden.`)
      }

      // Exakter (case-insensitive) Namenstreffer gewinnt: "Support Mail" darf
      // NICHT als mehrdeutig gelten, nur weil "Support Mail 2" den Teilstring
      // ebenfalls enthaelt (die Suche ist ein Substring-ilike). Sonst lieferte
      // set_active_knowledge_base faelschlich multiple_matches und der GANZE
      // Lauf wurde ok:false — obwohl die KB eindeutig bestimmbar war.
      const exactMatches = candidates.filter(
        (kb: any) => String(kb.name || "").trim().toLowerCase() === searchName.trim().toLowerCase()
      )
      const resolved = exactMatches.length === 1 ? exactMatches : candidates

      if (resolved.length > 1) {
        // Echte Mehrdeutigkeit ist KEIN Fehlschlag, sondern eine Rueckfrage.
        // NICHT success:false zurueckgeben (das markiert den gesamten Lauf als
        // fehlgeschlagen) — stattdessen ein klarer Disambiguierungs-Hinweis,
        // damit der Agent gezielt per knowledge_base_id nachlegt.
        return {
          result: {
            success: true,
            needs_disambiguation: true,
            reason: "multiple_matches",
            hinweis: `Mehrere Datenbanken passen zu "${searchName}". Rufe set_active_knowledge_base erneut mit der passenden knowledge_base_id auf.`,
            candidates: resolved.map((kb: any) => ({ id: kb.id, name: kb.name }))
          }
        } as ToolExecutionResult
      }

      const kb = resolved[0]
      return {
        result: {
          success: true,
          active_knowledge_base_id: kb.id,
          active_knowledge_base_name: kb.name
        },
        nextActiveKnowledgeBaseId: kb.id,
        nextActiveKnowledgeBaseName: kb.name,
        nextCompanyId: kb.company_id || defaultCompanyId || null
      } as ToolExecutionResult
    }

    case "create_knowledge_base": {
      const name = asString(args?.name, "name")
      const description = asOptionalString(args?.description)
      const shouldSetActive = typeof args?.set_active === "boolean" ? Boolean(args.set_active) : true

      const insertPayload: Record<string, any> = {
        user_id: userId,
        name
      }
      if (description) {
        insertPayload.description = description
      }
      if (defaultCompanyId) {
        insertPayload.company_id = defaultCompanyId
      }

      const { data: createdKb, error: createError } = await authClient
        .from("knowledge_bases")
        .insert(insertPayload)
        .select("id, name, description, sharing, company_id, created_at")
        .single()

      if (createError || !createdKb) {
        throw new Error(
          `Wissensdatenbank konnte nicht erstellt werden: ${createError?.message || "unbekannt"}`
        )
      }

      return {
        result: {
          success: true,
          knowledge_base_id: createdKb.id,
          knowledge_base: {
            id: createdKb.id,
            name: createdKb.name,
            description: createdKb.description || null,
            sharing: createdKb.sharing || null,
            company_id: createdKb.company_id || null,
            created_at: createdKb.created_at || null
          },
          set_active: shouldSetActive
        },
        nextActiveKnowledgeBaseId: shouldSetActive ? createdKb.id : undefined,
        nextActiveKnowledgeBaseName: shouldSetActive ? createdKb.name : undefined,
        nextCompanyId: createdKb.company_id || defaultCompanyId || null
      } as ToolExecutionResult
    }

    case "list_documents": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      // Standard 500 (statt 25): eine Runde liefert die VOLLSTAENDIGE Liste
      // normaler KBs. Der alte Cap 25 zwang den Agenten, fehlende Dokumente per
      // query-Raten zu suchen (Runaway, blieb unvollstaendig: "28 von 35").
      const limit = asLimit(args?.limit, 500, 1000)
      const query = asOptionalString(args?.query)

      let allDocuments: any[] = []
      try {
        // Alles laden (interner kbItems-Cap 5000), dann erst auf den angefragten
        // limit schneiden → 'total' ist ehrlich, 'complete' ist verlaesslich.
        allDocuments = await loadDocumentsForList({
          authClient,
          knowledgeBaseId: resolvedKbId,
          query,
          limit: 5000
        })
      } catch (error: any) {
        throw new Error(`Dokumente konnten nicht geladen werden: ${error?.message || "unbekannter Fehler"}`)
      }

      const total = allDocuments.length
      const documents = allDocuments.slice(0, limit)
      const complete = documents.length >= total

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          count: documents.length,
          total,
          complete,
          // Authoritatives Vollstaendigkeits-Signal: bei complete=true IST das
          // die ganze Liste — NICHT erneut mit anderen Begriffen auflisten.
          ...(complete
            ? {}
            : {
                truncated: true,
                hinweis: `Es gibt ${total} Dokumente (Filter: ${query ? `"${query}"` : "keiner"}); ${documents.length} zurueckgegeben. Zum Eingrenzen den 'query'-Filter nutzen oder 'limit' erhoehen — NICHT dieselbe Liste mit anderen Suchbegriffen erneut abfragen.`,
              }),
          documents: documents.map((doc: any) => ({
            id: doc.id,
            title: doc.title || doc.file_name || "Unbekannt",
            file_name: doc.file_name || null,
            file_type: doc.file_type || null,
            file_size: doc.file_size || null,
            created_at: doc.created_at || null
          }))
        }
      } as ToolExecutionResult
    }

    case "get_knowledge_overview": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      await assertKbBelongsToCompany(authClient, resolvedKbId, defaultCompanyId, userId)

      const overview = await buildKbOverview({
        serviceClient,
        knowledgeBaseId: resolvedKbId,
        companyId: defaultCompanyId,
        maxThemes: asLimit(args?.max_themes, 25, 100),
        refresh: args?.refresh === true,
        backend: { url: SUPPORT_BACKEND_URL, apiKey: KNOWLEDGE_API_KEY },
      })

      return { result: overview } as ToolExecutionResult
    }

    case "generate_question_prompt": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      await assertKbBelongsToCompany(authClient, resolvedKbId, defaultCompanyId, userId)

      const problemContext = asOptionalString(args?.problem_context)
      const exampleRequest = asOptionalString(args?.example_customer_request)
      const style = asOptionalString(args?.style) === "detailed" ? "detailed" : "compact"

      const overview = await buildKbOverview({
        serviceClient,
        knowledgeBaseId: resolvedKbId,
        companyId: defaultCompanyId,
        maxThemes: 30,
        refresh: false,
        backend: { url: SUPPORT_BACKEND_URL, apiKey: KNOWLEDGE_API_KEY },
      })

      // Best-effort coverage probe: does the example request actually retrieve
      // anything? A zero-hit example is strong evidence of non-KB data.
      let coverageNote: string | null = null
      if (exampleRequest) {
        try {
          const probe = await fetch(KNOWLEDGE_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": KNOWLEDGE_API_KEY },
            body: JSON.stringify({
              company_id: defaultCompanyId,
              kb_id: resolvedKbId,
              subject: exampleRequest,
              body: "",
              enable_hybrid: true,
              max_results: 4,
              detect_language: true,
            }),
          })
          if (probe.ok) {
            const pj = await probe.json()
            const hits = (pj.kb_results || []).filter(
              (r: any) => (r.ki_content || r.chunk_content || "").trim().length > 5
            )
            coverageNote =
              hits.length > 0
                ? `Die Beispielanfrage liefert ${hits.length} substantielle KB-Treffer.`
                : "Die Beispielanfrage liefert KEINE substantiellen KB-Treffer — Indiz für Nicht-KB-Daten oder eine Wissenslücke."
          }
        } catch {
          coverageNote = null
        }
      }

      const proposal = await generateFragenprompt({
        openai,
        model: AUX_MODEL,
        overview,
        problemContext,
        exampleCustomerRequest: exampleRequest,
        coverageNote,
        style,
      })

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          proposal,
          as_of: overview.as_of,
          persisted: false,
          note: "Vorschlag — NICHT gespeichert. Zur Übernahme muss er bestätigt und über create_question_prompt (Mail-Agent) gespeichert werden.",
        },
      } as ToolExecutionResult
    }

    case "search_knowledge": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const rawQuery = asString(args?.query, "query")
      const query = normalizeSearchQuery(rawQuery)
      const limit = asLimit(args?.limit, 6)

      // Call Support-Backend /api/knowledge/retrieve
      try {
        const apiResponse = await fetch(KNOWLEDGE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": KNOWLEDGE_API_KEY,
          },
          body: JSON.stringify({
            company_id: defaultCompanyId,
            kb_id: resolvedKbId,
            subject: query,
            body: "",
            enable_hybrid: true,
            max_results: limit,
            detect_language: true,
          })
        })

        if (apiResponse.ok) {
          const apiData = await apiResponse.json()
          const kbResults = (apiData.kb_results || []).slice(0, limit)
          const hasSubstantiveResults = kbResults.length > 0 &&
            kbResults.some((r: any) => (r.ki_content || r.chunk_content || "").trim().length > 5)

          if (hasSubstantiveResults) {
            return {
              result: {
                knowledge_base_id: resolvedKbId,
                query,
                count: kbResults.length,
                source: "knowledge_api",
                results: kbResults.map((item: any) => ({
                  id: item.chunk_id,
                  content: item.ki_content || item.chunk_content,
                  chunk_content: item.chunk_content,
                  similarity: item.similarity,
                  source_name: item.source_name || null,
                  fact_type: item.fact_type || null,
                }))
              }
            } as ToolExecutionResult
          }
        }
      } catch {
        // Fallback to RPC/direct search below
      }

      let results: any[] = []
      let source = "rpc"

      // Try RPC search first
      try {
        const { data, error } = await authClient.rpc("search_knowledge_items_in_base", {
          p_knowledge_base_id: resolvedKbId,
          p_search_term: query,
          p_source_filter: null,
          p_date_filter: null,
          p_limit: limit,
          p_offset: 0
        })
        if (!error && Array.isArray(data) && data.length > 0) {
          results = normalizeSearchResults({ results: data }, limit)
        }
      } catch {
        // RPC failed, will try direct query
      }

      // Fallback: direct DB query if RPC returned nothing (e.g. wildcard search, no embeddings)
      if (results.length === 0) {
        const isWildcard = query === "*" || query === "**" || query.length <= 1

        let directQuery = serviceClient
          .from("knowledge_items")
          .select("id, content, question, fact_type, source_name, source_chunk, document_id, created_at")
          .eq("knowledge_base_id", resolvedKbId)
          .order("created_at", { ascending: false })

        if (!isWildcard && query.length > 1) {
          directQuery = directQuery.or(`content.ilike.%${query}%,question.ilike.%${query}%`)
        }

        const { data: directData } = await directQuery.limit(limit)
        if (Array.isArray(directData) && directData.length > 0) {
          results = directData.map((item: any) => ({
            id: item.id,
            knowledge_item_id: item.id,
            source_chunk: item.source_chunk || null,
            chunk_id: item.source_chunk || null,
            fact_type: item.fact_type || null,
            source_name: item.source_name || null,
            document_id: item.document_id || null,
            content: clip(String(item.content || item.question || ""), 500),
            similarity: null,
            created_at: item.created_at || null
          }))
          source = "direct"
        }
      }

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          query,
          count: results.length,
          source,
          results
        }
      } as ToolExecutionResult
    }

    case "debug_knowledge_search": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      await assertKbBelongsToCompany(serviceClient, resolvedKbId, defaultCompanyId, userId)
      const rawQuery = asString(args?.query, "query")
      const query = normalizeSearchQuery(rawQuery)
      const maxResults = asLimit(args?.max_results, 10)

      const apiResponse = await fetch(KNOWLEDGE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": KNOWLEDGE_API_KEY,
        },
        body: JSON.stringify({
          company_id: defaultCompanyId,
          kb_id: resolvedKbId,
          subject: query,
          body: "",
          enable_hybrid: true,
          max_results: maxResults,
          detect_language: false,
          include_examples: false,
        })
      })

      if (!apiResponse.ok) {
        throw new Error(`Wissenssuche-API antwortete mit ${apiResponse.status}`)
      }

      const apiData = await apiResponse.json()
      const meta = apiData.search_metadata || {}
      const chunks = (apiData.kb_results || []).slice(0, maxResults)

      // Build a human-readable verdict so the agent doesn't have to recompute the math.
      const verdicts: string[] = []
      if (chunks.length === 0) {
        const raw = meta.total_raw_results ?? 0
        const minThr = meta.min_relevance_threshold ?? 0.25
        const droppedThr = meta.dropped_below_threshold ?? 0
        const droppedAmb = meta.dropped_ambiguous_low_sim ?? 0
        verdicts.push(
          `0 chunks returned: ${raw} raw hits → ${meta.deduplicated_chunks ?? 0} dedup → ${droppedThr} dropped < ${minThr} threshold, ${droppedAmb} dropped by ambiguous floor.`
        )
        if (raw === 0) {
          verdicts.push("Keine einzige Vector/Hybrid/Graph-Channel hat überhaupt Treffer geliefert. Embedding-Mismatch — der Inhalt ist semantisch sehr weit weg von der Anfrage. Probiere search_kb_text mit Schlüsselwörtern aus der Anfrage (alle Begriffe in EINEM Aufruf).")
        } else if (droppedThr > 0 || droppedAmb > 0) {
          verdicts.push(`Treffer waren da, wurden aber gefiltert. Wenn der erwartete Chunk dabei war: Fakt-Wording schärfen oder explizit zur Anfrage passenden Fakt anlegen.`)
        }
      } else {
        const top = chunks[0]
        const topTheme = top.community_theme ? `community '${top.community_theme}' (cid=${top.community_id})` : `cid=${top.community_id ?? "—"}`
        const topConf = top.confidence || "(no confidence — pure vector hit)"
        verdicts.push(
          `Top result: ${topTheme} at sim=${(top.similarity ?? 0).toFixed(3)} via ${top.search_source} — ${topConf}.`
        )

        // Communities represented in top-N
        const communities = new Set<number>()
        for (const c of chunks) if (c.community_id != null) communities.add(c.community_id)
        if (communities.size === 1 && chunks.length >= 3) {
          verdicts.push(`Alle ${chunks.length} Top-Treffer aus DERSELBEN Community — der Suche fehlt evtl. thematische Breite. Wenn dem Kunden hier was anderes wichtiger ist, neuen Fakt im richtigen Cluster.`)
        }

        // Confidence overview
        const confCounts: Record<string, number> = {}
        for (const c of chunks) {
          const k = c.confidence || "(none)"
          confCounts[k] = (confCounts[k] || 0) + 1
        }
        const confSummary = Object.entries(confCounts).map(([k, v]) => `${k}:${v}`).join(", ")
        verdicts.push(`Confidence-Verteilung: ${confSummary}`)

        if ((meta.dropped_ambiguous_low_sim ?? 0) > 0) {
          verdicts.push(`${meta.dropped_ambiguous_low_sim} ambiguous-Hits unter ${meta.ambiguous_min_similarity ?? 0.40} wurden gefiltert.`)
        }
      }

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          query,
          verdict: verdicts.join(" "),
          search_metadata: {
            queries: meta.queries || [],
            total_raw_results: meta.total_raw_results ?? 0,
            deduplicated_chunks: meta.deduplicated_chunks ?? 0,
            dropped_below_threshold: meta.dropped_below_threshold ?? 0,
            dropped_ambiguous_low_sim: meta.dropped_ambiguous_low_sim ?? 0,
            min_relevance_threshold: meta.min_relevance_threshold ?? 0.25,
            ambiguous_min_similarity: meta.ambiguous_min_similarity ?? 0.40,
            returned_chunks: chunks.length,
            errors: meta.errors ?? 0,
            hybrid_enabled: meta.hybrid_enabled ?? true,
            graph_chunks_found: meta.graph_chunks_found ?? 0,
            graph_entities_matched: meta.graph_entities_matched || [],
          },
          chunks: chunks.map((c: any) => ({
            chunk_id: c.chunk_id,
            similarity: c.similarity,
            search_source: c.search_source,
            community_id: c.community_id,
            community_theme: c.community_theme,
            confidence: c.confidence,
            graph_entity: c.graph_entity,
            graph_hop: c.graph_hop,
            source_name: c.source_name,
            chunk_preview: clip(String(c.chunk_content || ""), 200),
            matched_facts: (c.matched_facts || []).slice(0, 5),
          })),
        }
      } as ToolExecutionResult
    }

    case "search_kb_text": {
      // Batch-Textsuche: ALLE Begriffe in EINER Postgres-RPC (Chunks + Fakten),
      // ersetzt die frueheren Einzel-Calls search_chunks_by_text/-facts_by_text
      // (pro Begriff 2 Tool-Calls x bis zu 12 DB-Roundtrips → jetzt 1 RPC).
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const rawQueries: unknown[] = Array.isArray(args?.queries)
        ? args.queries
        : typeof args?.query === "string" ? [args.query] : []
      const queries = Array.from(
        new Set(rawQueries.map((q) => String(q ?? "").trim()).filter((q) => q.length >= 2))
      ).slice(0, 10)
      if (queries.length === 0) {
        throw new Error("queries muss mindestens einen Begriff mit >= 2 Zeichen enthalten")
      }
      const chunkLimit = asLimit(args?.chunk_limit, 5, 20)
      const factLimit = asLimit(args?.fact_limit, 6, 30)

      const { data, error } = await authClient.rpc("search_kb_text_batch", {
        p_kb_id: resolvedKbId,
        p_queries: queries,
        p_chunk_limit: chunkLimit,
        p_fact_limit: factLimit
      })
      if (error) {
        throw new Error(`Textsuche fehlgeschlagen: ${error.message}`)
      }

      const rpcResults = Array.isArray((data as any)?.results) ? (data as any).results : []
      // Previews kompakt halten — die RPC liefert bis 400 Zeichen, fuer die
      // LLM-History reichen kuerzere Ausschnitte (Volltext via get_chunk_details).
      const results = rpcResults.map((r: any) => ({
        query: String(r?.query ?? ""),
        chunk_total: Number(r?.chunk_total ?? 0),
        chunks: (Array.isArray(r?.chunks) ? r.chunks : []).map((c: any) => ({
          chunk_id: c?.chunk_id,
          content_preview: clip(String(c?.content_preview || ""), 200),
          content_position: c?.content_position,
          document_id: c?.document_id,
          document_name: c?.document_name ?? null,
          fact_count: Number(c?.fact_count ?? 0)
        })),
        fact_total: Number(r?.fact_total ?? 0),
        facts: (Array.isArray(r?.facts) ? r.facts : []).map((f: any) => ({
          fact_id: f?.fact_id,
          content: clip(String(f?.content || ""), 200),
          question: clip(String(f?.question || ""), 140),
          fact_type: f?.fact_type ?? null,
          source_name: f?.source_name ?? null,
          source_chunk: f?.source_chunk ?? null
        }))
      }))

      return {
        result: { knowledge_base_id: resolvedKbId, queries, results }
      } as ToolExecutionResult
    }

    case "search_chunks_by_text": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      await assertKbBelongsToCompany(serviceClient, resolvedKbId, defaultCompanyId, userId)
      const query = asString(args?.query, "query").trim()
      const limit = asLimit(args?.limit, 20)

      if (query.length < 2) {
        throw new Error("query muss mindestens 2 Zeichen haben")
      }

      // ILIKE on document_chunks.content, scoped to documents in this KB.
      // We can't filter document_chunks directly by knowledge_base_id (column
      // doesn't exist), so we filter by company + then check via document join.
      // Easier: join via knowledge_items.source_chunk → kb_id.
      // Pragmatic path: get all chunk_ids that have at least one fact in this KB,
      // then ilike-search those chunks.
      const { data: kiRows, error: kiErr } = await authClient
        .from("knowledge_items")
        .select("source_chunk")
        .eq("knowledge_base_id", resolvedKbId)
        .not("source_chunk", "is", null)
        .limit(2000)

      if (kiErr) {
        throw new Error(`Could not list KB chunks: ${kiErr.message}`)
      }

      const kbChunkIds = Array.from(new Set((kiRows || []).map((r: any) => r.source_chunk).filter(Boolean)))
      if (kbChunkIds.length === 0) {
        return {
          result: { knowledge_base_id: resolvedKbId, query, count: 0, chunks: [] }
        } as ToolExecutionResult
      }

      // Search in batches of 200 to keep URL short
      const matches: any[] = []
      for (let i = 0; i < kbChunkIds.length && matches.length < limit; i += 200) {
        const slice = kbChunkIds.slice(i, i + 200)
        const { data, error } = await authClient
          .from("document_chunks")
          .select("id, content, content_position, document_id, documents:document_id(file_name, title)")
          .in("id", slice)
          .ilike("content", `%${query}%`)
          .limit(limit - matches.length)
        if (!error && Array.isArray(data)) {
          matches.push(...data)
        }
      }

      // Fact counts per matching chunk
      const matchIds = matches.map((m: any) => m.id)
      const factCounts: Record<string, number> = {}
      if (matchIds.length > 0) {
        const { data: factRows } = await authClient
          .from("knowledge_items")
          .select("source_chunk")
          .in("source_chunk", matchIds)
          .eq("knowledge_base_id", resolvedKbId)
        for (const r of (factRows || []) as any[]) {
          factCounts[r.source_chunk] = (factCounts[r.source_chunk] || 0) + 1
        }
      }

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          query,
          count: matches.length,
          chunks: matches.slice(0, limit).map((c: any) => ({
            chunk_id: c.id,
            content_preview: clip(String(c.content || ""), 220),
            content_position: c.content_position,
            document_id: c.document_id,
            document_name: c.documents?.title || c.documents?.file_name || null,
            fact_count: factCounts[c.id] || 0,
          })),
        }
      } as ToolExecutionResult
    }

    case "search_facts_by_text": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      await assertKbBelongsToCompany(serviceClient, resolvedKbId, defaultCompanyId, userId)
      const query = asString(args?.query, "query").trim()
      const factType = typeof args?.fact_type === "string" ? args.fact_type.trim() : null
      const sourceFilter = typeof args?.source_filter === "string" ? args.source_filter.trim() : null
      const limit = asLimit(args?.limit, 30)

      if (query.length < 2) {
        throw new Error("query muss mindestens 2 Zeichen haben")
      }

      let q = authClient
        .from("knowledge_items")
        .select("id, content, question, fact_type, source_name, source_chunk, created_at")
        .eq("knowledge_base_id", resolvedKbId)
        .or(`content.ilike.%${query}%,question.ilike.%${query}%`)
        .order("created_at", { ascending: false })
        .limit(limit)

      if (factType) q = q.eq("fact_type", factType)
      if (sourceFilter) q = q.ilike("source_name", `%${sourceFilter}%`)

      const { data, error } = await q
      if (error) {
        throw new Error(`Fakten-Suche fehlgeschlagen: ${error.message}`)
      }

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          query,
          fact_type: factType,
          source_filter: sourceFilter,
          count: (data || []).length,
          facts: (data || []).map((f: any) => ({
            id: f.id,
            content: clip(String(f.content || ""), 280),
            question: clip(String(f.question || ""), 220),
            fact_type: f.fact_type,
            source_name: f.source_name,
            source_chunk: f.source_chunk,
            created_at: f.created_at,
          })),
        }
      } as ToolExecutionResult
    }

    case "get_chunk_details": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      // Batch-faehig: chunk_ids[] laedt mehrere Chunks parallel in EINEM
      // Tool-Call (statt N sequenzieller Runden). chunk_id bleibt als
      // Einzel-Variante mit unveraendertem Ergebnisformat erhalten.
      const requestedIds: string[] = Array.isArray(args?.chunk_ids)
        ? args.chunk_ids.map((x: any) => String(x ?? "").trim()).filter(Boolean)
        : []
      const singleId = asOptionalString(args?.chunk_id)
      if (singleId) requestedIds.unshift(singleId)
      const chunkIds = Array.from(new Set(requestedIds)).slice(0, 8)
      if (chunkIds.length === 0) {
        throw new Error("chunk_id oder chunk_ids ist erforderlich")
      }

      const loadOne = async (chunkId: string) => {
        const { chunk, document } = await getChunkAndDocument(authClient, chunkId, resolvedKbId)
        const { data: facts, error: factsError } = await authClient
          .from("knowledge_items")
          .select("id, content, question, fact_type, source_name, created_at")
          .eq("source_chunk", chunkId)
          .order("created_at", { ascending: false })
          .limit(10)
        if (factsError) {
          throw new Error(`Fakten konnten nicht geladen werden: ${factsError.message}`)
        }
        return {
          chunk: {
            id: chunk.id,
            position: chunk.content_position,
            // Vollstaendiger Chunk-Text (NICHT clippen) — der Agent braucht
            // den kompletten aktuellen Inhalt, um update_chunk_content sicher
            // anwenden zu koennen, ohne bestehendes Wissen zu ueberschreiben.
            content: String(chunk.content || ""),
            content_length: String(chunk.content || "").length,
            document_id: chunk.document_id
          },
          document: {
            id: document.id,
            title: document.title || document.file_name || "Unbekannt"
          },
          facts: (facts || []).map((fact: any) => ({
            id: fact.id,
            fact_type: fact.fact_type,
            content: clip(String(fact.content || fact.question || ""), 220),
            created_at: fact.created_at
          }))
        }
      }

      if (chunkIds.length === 1) {
        return { result: await loadOne(chunkIds[0]) } as ToolExecutionResult
      }

      const settled = await Promise.allSettled(chunkIds.map(loadOne))
      const chunks: any[] = []
      const loadErrors: Array<{ chunk_id: string; error: string }> = []
      settled.forEach((s, i) => {
        if (s.status === "fulfilled") chunks.push(s.value)
        else loadErrors.push({ chunk_id: chunkIds[i], error: s.reason?.message || "Chunk konnte nicht geladen werden." })
      })
      return {
        result: {
          count: chunks.length,
          chunks,
          ...(loadErrors.length > 0 ? { errors: loadErrors } : {})
        }
      } as ToolExecutionResult
    }

    case "create_chunk": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const content = asString(args?.content, "content")

      if (content.length < 10) {
        throw new Error("Der neue Chunk ist zu kurz.")
      }

      let documentId = asOptionalString(args?.document_id)
      const documentTitle = asOptionalString(args?.document_title)

      if (!documentId && documentTitle) {
        let candidates: any[] = []
        try {
          candidates = await loadDocumentsForList({
            authClient,
            knowledgeBaseId: resolvedKbId,
            query: documentTitle,
            limit: 5
          })
        } catch (error: any) {
          throw new Error(`Dokumentsuche fehlgeschlagen: ${error?.message || "unbekannter Fehler"}`)
        }

        if (!candidates || candidates.length === 0) {
          throw new Error("Kein passendes Dokument gefunden. Nutze list_documents zur Auswahl.")
        }

        if (candidates.length > 1) {
          throw new Error(
            `Mehrere Dokumente passen: ${candidates
              .map((d: any) => `${d.title || d.file_name} (${String(d.id).slice(0, 8)})`)
              .join(", ")}. Bitte document_id angeben.`
          )
        }

        documentId = candidates[0].id
      }

      if (!documentId) {
        throw new Error(
          "document_id oder document_title ist erforderlich. Fuer neues Wissen ohne bestehendes Dokument nutze upload_text_document."
        )
      }

      const { data: document, error: docError } = await authClient
        .from("documents")
        .select("id, title, file_name, file_type, file_size, storage_url, workspace_id, company_id")
        .eq("id", documentId)
        .single()

      if (docError || !document) {
        throw new Error("Dokument nicht gefunden oder nicht zugreifbar.")
      }

      const relationStatus = await getDocumentKbRelationStatus({
        authClient,
        documentId,
        knowledgeBaseId: resolvedKbId
      })

      if (relationStatus === "other") {
        throw new Error("Dokument gehört nicht zur aktiven Wissensdatenbank.")
      }

      // Struktur-Waechter-Guard (2026-07-02): kein stilles Anlegen von
      // Duplikat-/Streu-Chunks. Kandidaten = Chunks des Ziel-Dokuments +
      // Chunks mit Facts in dieser KB (gleicher pragmatischer Scope wie
      // search_chunks_by_text). success:false statt throw, damit der Agent
      // den bestehenden Chunk erweitert statt blind zu retryen.
      if (args?.force_create !== true) {
        const candidateIds = new Set<string>()
        const { data: docChunkRows } = await serviceClient
          .from("document_chunks")
          .select("id")
          .eq("document_id", documentId)
          .limit(100)
        for (const r of (docChunkRows || []) as any[]) candidateIds.add(r.id)
        const { data: kbFactRows } = await authClient
          .from("knowledge_items")
          .select("source_chunk")
          .eq("knowledge_base_id", resolvedKbId)
          .not("source_chunk", "is", null)
          .limit(1000)
        for (const r of (kbFactRows || []) as any[]) {
          if (r.source_chunk) candidateIds.add(r.source_chunk)
          if (candidateIds.size >= 300) break
        }

        const candidates: Array<{ id: string; content: string | null; document_id?: string | null }> = []
        const idList = Array.from(candidateIds)
        for (let i = 0; i < idList.length; i += 100) {
          const slice = idList.slice(i, i + 100)
          const { data: rows } = await serviceClient
            .from("document_chunks")
            .select("id, content, document_id")
            .in("id", slice)
          if (Array.isArray(rows)) candidates.push(...(rows as any[]))
        }

        const suspects = findOverlappingChunks(content, candidates)
        if (suspects.length > 0) {
          return {
            result: {
              success: false,
              duplicate_check: "overlap_detected",
              duplicate_suspects: suspects,
              message:
                "NICHT angelegt: Es existiert bereits mindestens ein Chunk mit starker inhaltlicher Ueberlappung. PFLICHT: den bestehenden Chunk via get_chunk_details + update_chunk_content ERWEITERN (Kategorie-Artikel statt Streu-Chunks — konkurrierende Chunks machen das RAG-Verhalten unvorhersagbar). Nur wenn der User einen bewussten Parallel-Chunk nach explizitem Hinweis bestaetigt hat: erneut mit force_create: true aufrufen.",
            }
          } as ToolExecutionResult
        }
      }

      const { data: existingChunks, error: positionError } = await serviceClient
        .from("document_chunks")
        .select("content_position")
        .eq("document_id", documentId)
        .order("content_position", { ascending: false })
        .limit(1)

      if (positionError) {
        throw new Error(`Chunk-Position konnte nicht ermittelt werden: ${positionError.message}`)
      }

      const nextPosition =
        existingChunks && existingChunks.length > 0 ? (existingChunks[0].content_position || 0) + 1 : 0

      const { data: createdChunk, error: chunkError } = await serviceClient
        .from("document_chunks")
        .insert({
          document_id: documentId,
          content,
          content_position: nextPosition,
          content_length: content.length,
          content_tokens: Math.ceil(content.split(/\s+/).length * 1.33),
          processing_complete: false,
          created_at: new Date().toISOString()
        })
        .select("id, document_id, content_position, created_at")
        .single()

      if (chunkError || !createdChunk) {
        throw new Error(`Chunk konnte nicht erstellt werden: ${chunkError?.message || "unbekannt"}`)
      }

      // Neuer Chunk ⇒ Facts (Such-Anker + Embeddings) sofort generieren,
      // sonst ist der Chunk für das Fact-basierte Retrieval unsichtbar.
      const factRegeneration = await runChunkFactRegeneration({
        serviceClient,
        chunk: {
          id: createdChunk.id,
          content,
          content_position: createdChunk.content_position,
          document_id: createdChunk.document_id
        },
        document,
        knowledgeBaseId: resolvedKbId,
        userId
      })

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          chunk: createdChunk,
          fact_regeneration: factRegeneration
        }
      } as ToolExecutionResult
    }

    case "add_fact_to_chunk": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const chunkId = asString(args?.chunk_id, "chunk_id")
      const fact = asString(args?.fact, "fact")
      const factType = typeof args?.fact_type === "string" && args.fact_type.trim() ? args.fact_type.trim() : "fact"

      const { chunk, document } = await getChunkAndDocument(authClient, chunkId, resolvedKbId)
      const embedding = (await generateEmbeddings(fact, "openai")) as number[]

      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error("Embedding für den Fakt konnte nicht erzeugt werden.")
      }

      const sourceName = document.title || document.file_name || `Document ${document.id}`

      const { data: insertedFact, error: insertError } = await serviceClient
        .from("knowledge_items")
        .insert({
          content: fact,
          question: factType === "question" ? fact : null,
          fact_type: factType,
          source_chunk: chunk.id,
          document_id: document.id,
          knowledge_base_id: resolvedKbId,
          user_id: userId,
          tokens: fact.split(/\s+/).length,
          source_type: "document",
          source_name: sourceName,
          openai_embedding: JSON.stringify(embedding),
          created_at: new Date().toISOString()
        })
        .select("id, created_at, fact_type")
        .single()

      if (insertError || !insertedFact) {
        throw new Error(`Fakt konnte nicht gespeichert werden: ${insertError?.message || "unbekannt"}`)
      }

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          fact: insertedFact
        }
      } as ToolExecutionResult
    }

    case "rename_knowledge_base": {
      const knowledgeBaseId = asString(args?.knowledge_base_id, "knowledge_base_id")
      const newName = asString(args?.new_name, "new_name")

      const { data: kb, error: kbError } = await authClient
        .from("knowledge_bases")
        .select("id, name, company_id")
        .eq("id", knowledgeBaseId)
        .single()

      if (kbError || !kb) {
        throw new Error("Wissensdatenbank nicht gefunden oder keine Berechtigung.")
      }

      const { data: updated, error: updateError } = await authClient
        .from("knowledge_bases")
        .update({ name: newName })
        .eq("id", knowledgeBaseId)
        .select("id, name, company_id")
        .single()

      if (updateError || !updated) {
        throw new Error(`Wissensdatenbank konnte nicht umbenannt werden: ${updateError?.message || "unbekannt"}`)
      }

      return {
        result: {
          success: true,
          knowledge_base_id: updated.id,
          old_name: kb.name,
          new_name: updated.name
        },
        nextActiveKnowledgeBaseId: updated.id === activeKnowledgeBaseId ? updated.id : undefined,
        nextActiveKnowledgeBaseName: updated.id === activeKnowledgeBaseId ? updated.name : undefined,
        nextCompanyId: updated.company_id || defaultCompanyId || null
      } as ToolExecutionResult
    }

    case "rename_document":
    case "rename_source": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const newName = asString(args?.new_name, "new_name")
      const documentIdArg = asOptionalString(args?.document_id) || asOptionalString(args?.source_id)
      const documentTitleArg =
        asOptionalString(args?.document_title) || asOptionalString(args?.source_name)

      const { document, documentId } = await resolveDocumentForKb({
        authClient,
        knowledgeBaseId: resolvedKbId,
        documentId: documentIdArg,
        documentTitle: documentTitleArg
      })

      const { data: updatedDocument, error: updateDocumentError } = await authClient
        .from("documents")
        .update({ title: newName })
        .eq("id", documentId)
        .select("id, title")
        .single()

      if (updateDocumentError || !updatedDocument) {
        throw new Error(`Dokument konnte nicht umbenannt werden: ${updateDocumentError?.message || "unbekannt"}`)
      }

      const { error: documentItemsUpdateError } = await authClient
        .from("knowledge_items")
        .update({ source_name: newName })
        .eq("knowledge_base_id", resolvedKbId)
        .eq("document_id", documentId)

      if (documentItemsUpdateError) {
        throw new Error(`Zugehörige Fakten konnten nicht umbenannt werden: ${documentItemsUpdateError.message}`)
      }

      const { data: chunkRows, error: chunksError } = await authClient
        .from("document_chunks")
        .select("id")
        .eq("document_id", documentId)

      if (chunksError) {
        throw new Error(`Chunk-Liste konnte nicht geladen werden: ${chunksError.message}`)
      }

      const chunkIds = (chunkRows || []).map((chunk: any) => chunk.id).filter(Boolean)
      const chunkBatchSize = 200
      for (let i = 0; i < chunkIds.length; i += chunkBatchSize) {
        const chunkBatch = chunkIds.slice(i, i + chunkBatchSize)
        const { error: chunkItemsUpdateError } = await authClient
          .from("knowledge_items")
          .update({ source_name: newName })
          .eq("knowledge_base_id", resolvedKbId)
          .in("source_chunk", chunkBatch)

        if (chunkItemsUpdateError) {
          throw new Error(`Chunk-bezogene Fakten konnten nicht umbenannt werden: ${chunkItemsUpdateError.message}`)
        }
      }

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          document: {
            id: updatedDocument.id,
            title: updatedDocument.title
          },
          old_name: document.title || document.file_name || null,
          new_name: updatedDocument.title
        }
      } as ToolExecutionResult
    }

    case "update_chunk_content": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const chunkId = asString(args?.chunk_id, "chunk_id")
      const content = asString(args?.content, "content")

      if (content.length < 10) {
        throw new Error("Der neue Chunk-Inhalt ist zu kurz.")
      }

      const { chunk, document } = await getChunkAndDocument(authClient, chunkId, resolvedKbId)
      const { data: updatedChunk, error: updateError } = await serviceClient
        .from("document_chunks")
        .update({
          content,
          content_length: content.length,
          content_tokens: Math.ceil(content.split(/\s+/).length * 1.33),
          processing_complete: false,
          updated_at: new Date().toISOString()
        })
        .eq("id", chunk.id)
        .select("id, document_id, content_position, updated_at")
        .single()

      if (updateError || !updatedChunk) {
        throw new Error(`Chunk konnte nicht aktualisiert werden: ${updateError?.message || "unbekannt"}`)
      }

      // Geänderter Chunk-Text ⇒ Facts (Such-Anker + Embeddings) automatisch
      // neu generieren, sonst findet das Retrieval weiterhin nur den alten
      // Stand. Gleicher Flow wie der UI-Button "Fakten neu generieren".
      const factRegeneration = await runChunkFactRegeneration({
        serviceClient,
        chunk: {
          id: chunk.id,
          content,
          content_position: chunk.content_position,
          document_id: chunk.document_id
        },
        document,
        knowledgeBaseId: resolvedKbId,
        userId
      })

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          chunk: updatedChunk,
          fact_regeneration: factRegeneration
        }
      } as ToolExecutionResult
    }

    case "update_fact_content": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const factId = asString(args?.fact_id, "fact_id")
      const content = asString(args?.content, "content")
      const factTypeArg = asOptionalString(args?.fact_type)

      const { data: factRow, error: factRowError } = await authClient
        .from("knowledge_items")
        .select("id, knowledge_base_id, source_chunk, fact_type")
        .eq("id", factId)
        .single()

      if (factRowError || !factRow) {
        throw new Error("Fakt nicht gefunden oder nicht zugreifbar.")
      }

      if (factRow.knowledge_base_id && factRow.knowledge_base_id !== resolvedKbId) {
        throw new Error("Fakt gehört nicht zur aktiven Wissensdatenbank.")
      }

      const nextFactType = factTypeArg || factRow.fact_type || "fact"
      const embedding = (await generateEmbeddings(content, "openai")) as number[]
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error("Embedding für den Fakt konnte nicht erzeugt werden.")
      }

      const updatePayload: Record<string, any> = {
        content,
        fact_type: nextFactType,
        tokens: Math.ceil(content.split(/\s+/).length)
      }
      if (nextFactType === "question") {
        updatePayload.question = content
        updatePayload.question_embedding = JSON.stringify(embedding)
      } else {
        updatePayload.question = null
        updatePayload.question_embedding = null
      }
      updatePayload.openai_embedding = JSON.stringify(embedding)

      const { data: updatedFact, error: updateError } = await serviceClient
        .from("knowledge_items")
        .update(updatePayload)
        .eq("id", factId)
        .select("id, source_chunk, fact_type")
        .single()

      if (updateError || !updatedFact) {
        throw new Error(`Fakt konnte nicht aktualisiert werden: ${updateError?.message || "unbekannt"}`)
      }

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          fact: {
            id: updatedFact.id,
            chunk_id: updatedFact.source_chunk || null,
            fact_type: updatedFact.fact_type,
            preview: clip(content, 120)
          }
        }
      } as ToolExecutionResult
    }

    case "delete_knowledge_base": {
      const knowledgeBaseId = asString(args?.knowledge_base_id, "knowledge_base_id")
      if (!isConfirmTrue(args?.confirm)) {
        throw new Error('Löschen wurde blockiert. Setze "confirm": true.')
      }

      const { data: kb, error: kbError } = await authClient
        .from("knowledge_bases")
        .select("id, name")
        .eq("id", knowledgeBaseId)
        .single()

      if (kbError || !kb) {
        throw new Error("Wissensdatenbank nicht gefunden oder keine Berechtigung.")
      }

      const { error: rpcError } = await authClient.rpc("delete_knowledge_base_and_related_data", {
        kb_id: knowledgeBaseId,
        user_id_check: userId
      })

      if (rpcError) {
        throw new Error(`Wissensdatenbank konnte nicht gelöscht werden: ${rpcError.message}`)
      }

      return {
        result: {
          success: true,
          deleted: {
            type: "knowledge_base",
            id: knowledgeBaseId,
            name: kb.name
          }
        },
        nextActiveKnowledgeBaseId: knowledgeBaseId === activeKnowledgeBaseId ? null : undefined
      } as ToolExecutionResult
    }

    case "delete_document":
    case "delete_source": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      if (!isConfirmTrue(args?.confirm)) {
        throw new Error('Löschen wurde blockiert. Setze "confirm": true.')
      }

      const documentIdArg = asOptionalString(args?.document_id) || asOptionalString(args?.source_id)
      const documentTitleArg =
        asOptionalString(args?.document_title) || asOptionalString(args?.source_name)

      const { document, documentId } = await resolveDocumentForKb({
        authClient,
        knowledgeBaseId: resolvedKbId,
        documentId: documentIdArg,
        documentTitle: documentTitleArg
      })

      const { error: rpcError } = await authClient.rpc("delete_document_and_related_data", {
        doc_id: documentId,
        user_id_check: userId
      })

      if (rpcError) {
        throw new Error(`Dokument konnte nicht gelöscht werden: ${rpcError.message}`)
      }

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          deleted: {
            type: "document",
            id: documentId,
            title: document.title || document.file_name || null
          }
        }
      } as ToolExecutionResult
    }

    case "delete_chunk": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const chunkId = asString(args?.chunk_id, "chunk_id")
      if (!isConfirmTrue(args?.confirm)) {
        throw new Error('Löschen wurde blockiert. Setze "confirm": true.')
      }

      const { chunk, document } = await getChunkAndDocument(authClient, chunkId, resolvedKbId)

      const { error: factsDeleteError } = await serviceClient
        .from("knowledge_items")
        .delete()
        .eq("source_chunk", chunk.id)

      if (factsDeleteError) {
        throw new Error(`Zugehörige Fakten konnten nicht gelöscht werden: ${factsDeleteError.message}`)
      }

      const { error: chunkDeleteError } = await serviceClient
        .from("document_chunks")
        .delete()
        .eq("id", chunk.id)

      if (chunkDeleteError) {
        throw new Error(`Chunk konnte nicht gelöscht werden: ${chunkDeleteError.message}`)
      }

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          deleted: {
            type: "chunk",
            id: chunk.id,
            document_id: document.id
          }
        }
      } as ToolExecutionResult
    }

    case "delete_fact": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const factId = asString(args?.fact_id, "fact_id")
      if (!isConfirmTrue(args?.confirm)) {
        throw new Error('Löschen wurde blockiert. Setze "confirm": true.')
      }

      const { data: factRow, error: factRowError } = await authClient
        .from("knowledge_items")
        .select("id, knowledge_base_id, source_chunk, content")
        .eq("id", factId)
        .single()

      if (factRowError || !factRow) {
        throw new Error("Fakt nicht gefunden oder nicht zugreifbar.")
      }

      if (factRow.knowledge_base_id && factRow.knowledge_base_id !== resolvedKbId) {
        throw new Error("Fakt gehört nicht zur aktiven Wissensdatenbank.")
      }

      const { error: deleteError } = await serviceClient.from("knowledge_items").delete().eq("id", factId)
      if (deleteError) {
        throw new Error(`Fakt konnte nicht gelöscht werden: ${deleteError.message}`)
      }

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          deleted: {
            type: "fact",
            id: factId,
            chunk_id: factRow.source_chunk || null,
            preview: clip(String(factRow.content || ""), 90)
          }
        }
      } as ToolExecutionResult
    }

    case "regenerate_chunk_facts": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const chunkId = asString(args?.chunk_id, "chunk_id")
      const customPrompt = asOptionalString(args?.custom_prompt)
      const { chunk, document } = await getChunkAndDocument(authClient, chunkId, resolvedKbId)

      // Vollständiger Regenerations-Flow (mark → Webhook → Poll → Cleanup),
      // identisch zum UI-Button. Ersetzt den früheren Fire-and-forget-Aufruf,
      // der alte Facts als Duplikate neben den neuen stehen ließ.
      const factRegeneration = await runChunkFactRegeneration({
        serviceClient,
        chunk: {
          id: chunk.id,
          content: chunk.content,
          content_position: chunk.content_position,
          document_id: chunk.document_id
        },
        document: {
          ...document,
          company_id: document.company_id || defaultCompanyId || null
        },
        knowledgeBaseId: resolvedKbId,
        userId,
        customPrompt
      })

      return {
        result: {
          success: factRegeneration.status !== "failed",
          chunk_id: chunk.id,
          knowledge_base_id: resolvedKbId,
          fact_regeneration: factRegeneration
        }
      } as ToolExecutionResult
    }

    case "run_mismatch_analysis": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const batchId = asOptionalString(args?.batch_id)
      const continueProcessing = Boolean(args?.continue_processing || batchId)

      const response = await callInternalKnowledgeApi<any>(
        internalApiBaseUrl,
        "/api/knowledge/find-mismatches",
        {
          knowledgeBaseId: resolvedKbId,
          batchId: batchId || undefined,
          continueProcessing
        }
      )

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          ...response
        }
      } as ToolExecutionResult
    }

    case "get_chunk_combine_suggestions": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))

      const response = await callInternalKnowledgeApi<any>(
        internalApiBaseUrl,
        "/api/knowledge/combine-suggestions",
        {
          knowledgeBaseId: resolvedKbId
        }
      )

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          ...response
        }
      } as ToolExecutionResult
    }

    case "execute_chunk_combine": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const primaryChunkId = asString(args?.primary_chunk_id, "primary_chunk_id")
      const mergeChunkIds = asOptionalStringArray(args?.merge_chunk_ids, 100)
      const manualKnowledgeItemIds = asOptionalStringArray(args?.manual_knowledge_item_ids, 200)

      if (!isConfirmTrue(args?.confirm)) {
        throw new Error('Combine wurde blockiert. Setze "confirm": true.')
      }

      if (mergeChunkIds.length === 0 && manualKnowledgeItemIds.length === 0) {
        throw new Error("Es wurden keine Merge-Kandidaten übergeben.")
      }

      const response = await callInternalKnowledgeApi<any>(
        internalApiBaseUrl,
        "/api/knowledge/combine-execute",
        {
          knowledgeBaseId: resolvedKbId,
          primaryChunkId,
          chunkIdsToMerge: mergeChunkIds,
          manualKnowledgeItemIds
        }
      )

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          ...response
        }
      } as ToolExecutionResult
    }

    case "upload_text_document": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const title = asString(args?.title, "title")
      const content = asString(args?.content, "content")
      const sourceName = asOptionalString(args?.source_name) || title

      if (content.length < 20) {
        throw new Error("Der Text ist zu kurz für einen sinnvollen Upload.")
      }

      const { data: kb, error: kbError } = await authClient
        .from("knowledge_bases")
        .select("id, name, company_id")
        .eq("id", resolvedKbId)
        .single()

      if (kbError || !kb) {
        throw new Error("Wissensdatenbank nicht gefunden oder keine Berechtigung.")
      }
      let processed: { documentId: string; finalTitle: string }
      try {
        processed = await processDocumentFromText({
          content,
          title,
          description: `Text-Upload via Agent${sourceName ? ` (${sourceName})` : ""}`,
          userId,
          companyId: kb.company_id || defaultCompanyId || null,
          knowledgeBaseId: resolvedKbId
        })
      } catch (error: any) {
        throw new Error(`Text-Upload fehlgeschlagen: ${error?.message || "unbekannt"}`)
      }

      return {
        result: {
          success: true,
          queued: true,
          provider: "text_upload_pipeline",
          knowledge_base_id: resolvedKbId,
          document: {
            id: processed.documentId,
            title: processed.finalTitle
          },
          source_name: sourceName
        }
      } as ToolExecutionResult
    }

    case "upload_file_from_url": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const fileUrl = asString(args?.file_url, "file_url")
      const sourceName = asOptionalString(args?.source_name)

      if (!/^https?:\/\//i.test(fileUrl)) {
        throw new Error("file_url muss mit http:// oder https:// beginnen.")
      }

      const { data: kb, error: kbError } = await authClient
        .from("knowledge_bases")
        .select("id, name, company_id")
        .eq("id", resolvedKbId)
        .single()

      if (kbError || !kb) {
        throw new Error("Wissensdatenbank nicht gefunden oder keine Berechtigung.")
      }

      const remoteResponse = await fetch(fileUrl)
      if (!remoteResponse.ok) {
        throw new Error(`Datei-Download fehlgeschlagen (${remoteResponse.status}).`)
      }

      const contentTypeHeader = (remoteResponse.headers.get("content-type") || "").toLowerCase()
      const fileNameFromUrl = getFileNameFromUrl(fileUrl)
      const fileExt = getFileExtension(fileNameFromUrl)
      const fallbackMimeFromExt = guessMimeTypeFromExtension(fileExt)

      if (contentTypeHeader.includes("text/html") && !fallbackMimeFromExt) {
        throw new Error(
          "Die URL zeigt auf eine Webseite statt auf eine Datei. Bitte gib einen direkten Dateilink (z. B. .pdf, .docx, .txt) an."
        )
      }

      const supportedMimeTypes = new Set([
        "application/pdf",
        "text/plain",
        "text/markdown",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "image/png",
        "image/jpeg",
        "image/webp",
        "application/msword"
      ])

      const normalizedMime = (contentTypeHeader.split(";")[0] || "").trim()
      const resolvedMime = normalizedMime || fallbackMimeFromExt || "application/octet-stream"

      if (!supportedMimeTypes.has(resolvedMime)) {
        throw new Error(
          `Nicht unterstützter Dateityp (${resolvedMime || "unbekannt"}). Erlaubt: PDF, DOC/DOCX, XLSX, TXT/MD, PNG/JPG/WEBP.`
        )
      }

      const blob = await remoteResponse.blob()
      const inferredName =
        sanitizeFileName(
          sourceName ||
            fileNameFromUrl ||
            `url-import-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}${fileExt || ".txt"}`
        )

      const downloadedFile = new File([blob], inferredName, {
        type: resolvedMime
      })

      const documentTitle = sourceName || inferredName.replace(/\.[^.]+$/, "")
      const createdDocumentId = await processDocument(
        downloadedFile,
        userId,
        documentTitle,
        `Import via URL: ${fileUrl}`,
        kb.company_id || defaultCompanyId || null,
        resolvedKbId
      )

      return {
        result: {
          success: true,
          queued: true,
          provider: "direct_file_download",
          knowledge_base_id: resolvedKbId,
          document: {
            id: createdDocumentId,
            title: documentTitle
          },
          import_url: fileUrl
        }
      } as ToolExecutionResult
    }

    case "present_code_block": {
      const content = asString(args?.content, "content")
      const title = asOptionalString(args?.title)
      const language = asOptionalString(args?.language)

      return {
        result: {
          title: title || null,
          language: language || null,
          content
        }
      } as ToolExecutionResult
    }

    case "present_table": {
      const columns = asStringArray(args?.columns, 12)
      const rows = asTableRows(args?.rows, Math.max(columns.length, 1), 40)
      const title = asOptionalString(args?.title)

      if (columns.length === 0) {
        throw new Error("columns darf nicht leer sein.")
      }
      if (rows.length === 0) {
        throw new Error("rows darf nicht leer sein.")
      }

      return {
        result: {
          title: title || null,
          columns,
          rows
        }
      } as ToolExecutionResult
    }

    case "present_interactive_choices": {
      const prompt = asString(args?.prompt, "prompt")
      const title = asOptionalString(args?.title)
      const options = asChoiceOptions(args?.options, 12)

      if (options.length < 2) {
        throw new Error("Mindestens zwei Auswahloptionen sind erforderlich.")
      }

      const rawMode = asOptionalString(args?.selection_mode)?.toLowerCase()
      const selectionMode: "single" | "multiple" | "either_or" =
        rawMode === "multiple" ? "multiple" : rawMode === "either_or" ? "either_or" : "single"

      const fallbackMin = selectionMode === "multiple" ? 1 : 1
      const fallbackMax = selectionMode === "multiple" ? options.length : 1

      const minSelectionsRaw =
        typeof args?.min_selections === "number" && Number.isFinite(args.min_selections)
          ? Math.round(args.min_selections)
          : fallbackMin
      const maxSelectionsRaw =
        typeof args?.max_selections === "number" && Number.isFinite(args.max_selections)
          ? Math.round(args.max_selections)
          : fallbackMax

      const minSelections = Math.max(0, Math.min(options.length, minSelectionsRaw))
      const maxSelections = Math.max(minSelections || 1, Math.min(options.length, maxSelectionsRaw))

      return {
        result: {
          title: title || null,
          prompt,
          selection_mode: selectionMode,
          options,
          min_selections: minSelections,
          max_selections: maxSelections,
          submit_label: asOptionalString(args?.submit_label) || null,
          response_prefix: asOptionalString(args?.response_prefix) || null
        }
      } as ToolExecutionResult
    }

    case "present_image": {
      const imageUrl = asString(args?.image_url, "image_url")
      const title = asOptionalString(args?.title)
      const alt = asOptionalString(args?.alt)

      if (!/^https?:\/\//i.test(imageUrl)) {
        throw new Error("image_url muss mit http:// oder https:// beginnen.")
      }

      return {
        result: {
          title: title || null,
          image_url: imageUrl,
          alt: alt || null
        }
      } as ToolExecutionResult
    }

    case "upload_attachment_to_kb": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      const attachmentUrl = asString(args?.attachment_url, "attachment_url")
      const title = asString(args?.title, "title")
      const sourceName = asOptionalString(args?.source_name)

      if (!/^https?:\/\//i.test(attachmentUrl)) {
        throw new Error("attachment_url muss mit http:// oder https:// beginnen.")
      }

      const { data: kb, error: kbError } = await authClient
        .from("knowledge_bases")
        .select("id, name, company_id")
        .eq("id", resolvedKbId)
        .single()

      if (kbError || !kb) {
        throw new Error("Wissensdatenbank nicht gefunden oder keine Berechtigung.")
      }

      // Download the attachment
      const remoteResponse = await fetch(attachmentUrl)
      if (!remoteResponse.ok) {
        throw new Error(`Datei-Download fehlgeschlagen (${remoteResponse.status}).`)
      }

      const contentTypeHeader = (remoteResponse.headers.get("content-type") || "").toLowerCase()
      const blob = await remoteResponse.blob()
      const ext = title.split(".").pop() || "bin"
      const inferredName = sanitizeFileName(sourceName || title)
      const resolvedMime = contentTypeHeader.split(";")[0]?.trim() || guessMimeTypeFromExtension(`.${ext}`) || "application/octet-stream"

      const downloadedFile = new File([blob], inferredName, { type: resolvedMime })

      const createdDocumentId = await processDocument(
        downloadedFile,
        userId,
        title,
        `Upload via Agent-Attachment: ${attachmentUrl}`,
        kb.company_id || defaultCompanyId || null,
        resolvedKbId
      )

      return {
        result: {
          success: true,
          queued: true,
          knowledge_base_id: resolvedKbId,
          document: { id: createdDocumentId, title },
          source_url: attachmentUrl
        }
      } as ToolExecutionResult
    }

    case "analyze_attachment": {
      const attachmentUrl = asString(args?.attachment_url, "attachment_url")
      const attachmentType = asOptionalString(args?.attachment_type) || ""
      const attachmentName = asOptionalString(args?.attachment_name) || "attachment"

      if (!/^https?:\/\//i.test(attachmentUrl)) {
        throw new Error("attachment_url muss mit http:// oder https:// beginnen.")
      }

      // For images: use OpenAI Vision
      if (attachmentType.startsWith("image/")) {
        const visionResponse = await openai.chat.completions.create({
          model: AUX_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Beschreibe den Inhalt dieses Bildes detailliert auf Deutsch. Wenn Text sichtbar ist, extrahiere diesen. Dateiname: ${attachmentName}` },
                { type: "image_url", image_url: { url: attachmentUrl, detail: "high" } }
              ]
            }
          ],
          // gpt-5.6-terra (Reasoning-Modell) verlangt max_completion_tokens
          // statt max_tokens; grosszuegiger Cap, damit Reasoning-Tokens die
          // JSON-Bildanalyse nicht verhungern lassen.
          max_completion_tokens: 6000,
        })

        const description = visionResponse.choices?.[0]?.message?.content || "Bildbeschreibung konnte nicht erstellt werden."
        return {
          result: {
            type: "image_analysis",
            file_name: attachmentName,
            mime_type: attachmentType,
            description,
            url: attachmentUrl
          }
        } as ToolExecutionResult
      }

      // For documents: download and extract text
      const remoteResponse = await fetch(attachmentUrl)
      if (!remoteResponse.ok) {
        throw new Error(`Datei-Download fehlgeschlagen (${remoteResponse.status}).`)
      }

      const blob = await remoteResponse.blob()
      const arrayBuffer = await blob.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      let extractedText = ""
      const lowerName = attachmentName.toLowerCase()

      if (lowerName.endsWith(".txt") || lowerName.endsWith(".md") || lowerName.endsWith(".csv")) {
        extractedText = buffer.toString("utf-8")
      } else if (lowerName.endsWith(".pdf") || attachmentType.includes("pdf")) {
        try {
          const pdfParse = (await import("pdf-parse")).default
          const parsed = await pdfParse(buffer)
          extractedText = parsed.text || ""
        } catch {
          extractedText = "[PDF-Extraktion fehlgeschlagen]"
        }
      } else if (lowerName.endsWith(".docx") || attachmentType.includes("wordprocessingml")) {
        try {
          const mammoth = await import("mammoth")
          const result = await mammoth.extractRawText({ buffer })
          extractedText = result.value || ""
        } catch {
          extractedText = "[DOCX-Extraktion fehlgeschlagen]"
        }
      } else {
        extractedText = `[Textextraktion für Dateityp "${attachmentType}" nicht unterstützt. Datei kann aber über upload_attachment_to_kb hochgeladen werden.]`
      }

      return {
        result: {
          type: "text_extraction",
          file_name: attachmentName,
          mime_type: attachmentType,
          text: extractedText.slice(0, 8000),
          text_length: extractedText.length,
          url: attachmentUrl
        }
      } as ToolExecutionResult
    }

    case "verify_fact_findability": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
      await assertKbBelongsToCompany(serviceClient, resolvedKbId, defaultCompanyId, userId)
      const referenceQuestion = asString(args?.reference_question, "reference_question")
      const expectedContent = asString(args?.expected_fact_content, "expected_fact_content")
      const expectedFactId = asOptionalString(args?.expected_fact_id)

      // Generate 4 search variants using a small LLM call
      const variantResponse = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        max_tokens: 600,
        messages: [
          {
            role: "system",
            content: `Du erzeugst Suchvarianten fuer eine Wissensdatenbank-Suche.
Gegeben eine Referenzfrage, erzeuge genau 4 alternative Formulierungen:
1. Umgangssprachlich (wie ein Laie fragen wuerde)
2. Keyword-basiert (nur Schluesselbegriffe, kein ganzer Satz)
3. Formal (wie in einem Geschaeftsbrief)
4. Indirekt (nicht als direkte Frage, z.B. "Ich moechte wissen ob...")

Antworte NUR als JSON-Array mit genau 4 Strings, keine Erklaerung.
Beispiel: ["Was muss ich zahlen?", "Preis Kosten Tarif", "Bitte teilen Sie mir die Kosten mit.", "Ich ueberlege ob das teuer ist."]`
          },
          {
            role: "user",
            content: referenceQuestion
          }
        ]
      })

      let variants: string[] = []
      try {
        const raw = variantResponse.choices?.[0]?.message?.content || "[]"
        const parsed = JSON.parse(raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim())
        if (Array.isArray(parsed)) variants = parsed.map((v: any) => String(v).trim()).filter(Boolean).slice(0, 4)
      } catch {
        // Fallback: simple keyword variant
        variants = [
          referenceQuestion.replace(/\?/g, "").trim(),
          referenceQuestion.split(" ").filter((w: string) => w.length > 3).join(" "),
          `Bitte informieren Sie mich: ${referenceQuestion}`,
          `Ich habe eine Frage bezueglich: ${referenceQuestion.replace(/\?/g, "").trim()}`
        ]
      }

      const allQueries = [referenceQuestion, ...variants]

      // Keyword-overlap matching: extract significant words from expected content
      const STOP_WORDS_DE = new Set([
        "der", "die", "das", "ein", "eine", "einer", "eines", "einem", "einen",
        "ist", "sind", "war", "waren", "wird", "werden", "wurde", "wurden",
        "hat", "haben", "hatte", "hatten", "kann", "können", "konnte", "konnten",
        "und", "oder", "aber", "auch", "als", "für", "von", "mit", "auf", "in",
        "an", "zu", "nach", "bei", "aus", "über", "unter", "durch", "bis",
        "nicht", "kein", "keine", "keinen", "keiner", "keinem",
        "ich", "du", "er", "sie", "es", "wir", "ihr", "man",
        "sich", "mein", "dein", "sein", "ihr", "unser", "euer",
        "dem", "den", "des", "dieser", "diese", "dieses", "diesem", "diesen",
        "dass", "wenn", "weil", "damit", "ob", "wie", "was", "wer", "wo",
        "noch", "schon", "nur", "sehr", "mehr", "dann", "also", "so",
        "alle", "alles", "andere", "anderen", "anderem", "anderer",
        "zum", "zur", "vom", "beim", "ins", "im", "am"
      ])

      function extractKeywords(text: string): Set<string> {
        return new Set(
          text
            .toLowerCase()
            .replace(/[^a-zäöüß0-9\s-]/g, " ")
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS_DE.has(w))
        )
      }

      function keywordOverlap(textA: string, textB: string): number {
        const wordsA = extractKeywords(textA)
        const wordsB = extractKeywords(textB)
        if (wordsA.size === 0 || wordsB.size === 0) return 0
        let matches = 0
        for (const w of wordsA) {
          if (wordsB.has(w)) matches++
        }
        return matches / Math.min(wordsA.size, wordsB.size)
      }

      // Run all 5 searches
      const searchResults: Array<{
        query: string
        variant_type: string
        top_results: Array<{
          content: string
          similarity: number | null
          id: string | null
          search_source?: string | null
          community_id?: number | null
          community_theme?: string | null
          confidence?: string | null
        }>
        found_in_top3: boolean
        found_in_top5: boolean
        best_match_position: number | null
        best_match_score: number | null
        best_match_community_theme: string | null
        best_match_confidence: string | null
        best_match_search_source: string | null
      }> = []

      const variantTypes = ["original", "umgangssprachlich", "keyword", "formal", "indirekt"]
      const expectedLower = expectedContent.toLowerCase()

      for (let i = 0; i < allQueries.length; i++) {
        const query = normalizeSearchQuery(allQueries[i])
        let results: any[] = []

        // Try Knowledge API first
        try {
          const apiResponse = await fetch(KNOWLEDGE_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": KNOWLEDGE_API_KEY,
            },
            body: JSON.stringify({
              company_id: defaultCompanyId,
              kb_id: resolvedKbId,
              subject: query,
              body: "",
              enable_hybrid: true,
              max_results: 5,
              detect_language: false,
            })
          })
          if (apiResponse.ok) {
            const apiData = await apiResponse.json()
            const kbResults = (apiData.kb_results || []).slice(0, 5)
            if (kbResults.length > 0 && kbResults.some((r: any) => (r.ki_content || r.chunk_content || "").trim().length > 5)) {
              results = kbResults.map((item: any) => ({
                id: item.chunk_id,
                content: item.ki_content || item.chunk_content,
                similarity: item.similarity,
                search_source: item.search_source ?? null,
                community_id: item.community_id ?? null,
                community_theme: item.community_theme ?? null,
                confidence: item.confidence ?? null,
              }))
            }
          }
        } catch {
          // Fallback to RPC/direct below
        }

        // Fallback: RPC search
        if (results.length === 0) {
          try {
            const { data } = await authClient.rpc("search_knowledge_items_in_base", {
              p_knowledge_base_id: resolvedKbId,
              p_search_term: query,
              p_source_filter: null,
              p_date_filter: null,
              p_limit: 5,
              p_offset: 0
            })
            if (Array.isArray(data) && data.length > 0) {
              results = normalizeSearchResults({ results: data }, 5)
            }
          } catch {
            // RPC failed
          }
        }

        // Fallback: direct DB query
        if (results.length === 0) {
          const { data: directData } = await serviceClient
            .from("knowledge_items")
            .select("id, content, question, fact_type, source_name, source_chunk")
            .eq("knowledge_base_id", resolvedKbId)
            .or(`content.ilike.%${query}%,question.ilike.%${query}%`)
            .limit(5)
          if (Array.isArray(directData) && directData.length > 0) {
            results = directData.map((item: any) => ({
              id: item.id,
              content: String(item.content || item.question || ""),
              similarity: null
            }))
          }
        }

        // Check if expected fact is in results
        let bestMatchPos: number | null = null
        let bestMatchScore: number | null = null
        let bestMatchTheme: string | null = null
        let bestMatchConfidence: string | null = null
        let bestMatchSource: string | null = null

        for (let j = 0; j < results.length; j++) {
          const content = String(results[j]?.content || "")
          const contentLower = content.toLowerCase()
          const itemId = String(results[j]?.id || "")

          // Match by exact ID
          const matchById = expectedFactId && itemId === expectedFactId

          // Match by substring inclusion (either direction)
          const matchBySubstring = contentLower.includes(expectedLower) || expectedLower.includes(contentLower.slice(0, 40))

          // Match by keyword overlap (≥50% of significant words from expected content appear in result)
          const overlap = keywordOverlap(expectedContent, content)
          // Also check overlap with the reference question itself (thematic relevance)
          const overlapWithQuestion = keywordOverlap(referenceQuestion, content)
          const matchByKeywords = overlap >= 0.5 || overlapWithQuestion >= 0.6

          if (matchById || matchBySubstring || matchByKeywords) {
            bestMatchPos = j + 1
            bestMatchScore = results[j]?.similarity ?? null
            bestMatchTheme = results[j]?.community_theme ?? null
            bestMatchConfidence = results[j]?.confidence ?? null
            bestMatchSource = results[j]?.search_source ?? null
            break
          }
        }

        searchResults.push({
          query,
          variant_type: variantTypes[i] || `variante_${i + 1}`,
          top_results: results.slice(0, 3).map((r: any) => ({
            content: clip(String(r.content || ""), 120),
            similarity: r.similarity ?? null,
            id: r.id || null,
            search_source: r.search_source ?? null,
            community_id: r.community_id ?? null,
            community_theme: r.community_theme ?? null,
            confidence: r.confidence ?? null,
          })),
          found_in_top3: bestMatchPos !== null && bestMatchPos <= 3,
          found_in_top5: bestMatchPos !== null && bestMatchPos <= 5,
          best_match_position: bestMatchPos,
          best_match_score: bestMatchScore,
          best_match_community_theme: bestMatchTheme,
          best_match_confidence: bestMatchConfidence,
          best_match_search_source: bestMatchSource,
        })
      }

      // Calculate overall verdict
      const passedCount = searchResults.filter(r => r.found_in_top3).length
      const totalVariants = searchResults.length
      const avgScore = searchResults
        .filter(r => r.best_match_score !== null)
        .reduce((sum, r) => sum + (r.best_match_score || 0), 0) /
        (searchResults.filter(r => r.best_match_score !== null).length || 1)

      const passed = passedCount >= 4
      const verdict = passed
        ? `BESTANDEN (${passedCount}/${totalVariants} in Top-3)`
        : `NICHT BESTANDEN (${passedCount}/${totalVariants} in Top-3)`

      const recommendations: string[] = []
      if (!passed) {
        const failedVariants = searchResults.filter(r => !r.found_in_top3)
        for (const fv of failedVariants) {
          const topHit = fv.top_results?.[0]
          const topHitContent = topHit?.content || null
          if (!fv.found_in_top5) {
            const hint = topHitContent ? ` Stattdessen gefunden: "${topHitContent.slice(0, 60)}..."` : " Keine Ergebnisse."
            const themeHint = topHit?.community_theme ? ` (Community: ${topHit.community_theme})` : ""
            recommendations.push(`Variante "${fv.variant_type}" (${fv.query.slice(0, 40)}): Erwarteter Fakt nicht in Top-5.${hint}${themeHint}`)
          } else {
            const themeHint = fv.best_match_community_theme ? ` Community: ${fv.best_match_community_theme}.` : ""
            const confHint = fv.best_match_confidence ? ` Confidence: ${fv.best_match_confidence}.` : ""
            recommendations.push(`Variante "${fv.variant_type}": Fakt in Position ${fv.best_match_position}, aber nicht in Top-3.${themeHint}${confHint} Fakt-Formulierung schärfen.`)
          }
        }

        // Theme-mismatch hint: top-1 hits land consistently in a DIFFERENT community than the matched fact
        const matchedThemes = searchResults
          .map(r => r.best_match_community_theme)
          .filter(Boolean) as string[]
        const topThemes = searchResults
          .map(r => r.top_results?.[0]?.community_theme)
          .filter(Boolean) as string[]
        if (matchedThemes.length >= 2 && topThemes.length >= 2) {
          const matchedSet = new Set(matchedThemes)
          const topSet = new Set(topThemes)
          const overlap = [...matchedSet].some(t => topSet.has(t))
          if (!overlap) {
            recommendations.push(
              `Theme-Mismatch: Erwarteter Fakt liegt in Community "${matchedThemes[0]}", die Suche landet aber konsistent in "${topThemes[0]}". Möglicherweise gehört der Fakt thematisch in eine andere Cluster, oder die Suche braucht mehr Vokabular zur "${matchedThemes[0]}"-Community.`
            )
          }
        }

        // Ambiguous-floor hint
        const ambigHits = searchResults.filter(r => r.best_match_confidence === "ambiguous")
        if (ambigHits.length >= 2) {
          recommendations.push(
            `${ambigHits.length} Varianten finden den Fakt nur via "ambiguous" Cross-Document-Inferenz — direkter extracted-Fakt fehlt. Erwäge add_fact_to_chunk im richtigen Quellchunk mit explizitem Bezug zur Anfrage.`
          )
        }

        if (avgScore < 0.45) {
          recommendations.push("Durchschnittlicher Score niedrig. Erwäge Schatten-Fakten oder Synonym-Enrichment.")
        }
      }

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          reference_question: referenceQuestion,
          expected_content: expectedContent,
          verdict,
          passed,
          passed_count: passedCount,
          total_variants: totalVariants,
          average_score: Math.round(avgScore * 100) / 100,
          variants: searchResults,
          recommendations
        }
      } as ToolExecutionResult
    }

    default:
      throw new Error(`Unbekanntes Tool: ${toolName}`)
  }
}

async function runAgentWorkflow(params: {
  body: AgentRequestBody
  message: string
  user: { id: string }
  authClient: any
  serviceClient: ReturnType<typeof createClient<Database>>
  internalApiBaseUrl: string
  crossAgentCompanyId?: string | null
  emit?: AgentStreamEmitter
  enableKickoffStream?: boolean
  /** WP-D2: X-Trace-Id des Orchestrator-Turns — in agent_messages.metadata geloggt. */
  traceId?: string | null
  signal?: AbortSignal
}): Promise<AgentRunResult> {
  const { body, message, user, authClient, serviceClient, internalApiBaseUrl, crossAgentCompanyId, enableKickoffStream, traceId, signal } = params
  const emit = params.emit || (() => {})

  const requestedConversationId = asOptionalString(body.conversationId)
  let currentKnowledgeBaseId = asOptionalString(body.knowledgeBaseId)

  if (enableKickoffStream) {
    const attachmentCount = Array.isArray(body.attachments)
      ? body.attachments.filter(att => att && typeof att.url === "string" && att.url.trim().length > 0).length
      : 0
    await emitKickoffTextFromModel({
      emit,
      message,
      attachmentCount,
      signal
    })
  }

  // Company scoping: cross-agent requests MUST be scoped to a specific company
  let currentCompanyId: string | null = crossAgentCompanyId || null

  if (!currentCompanyId) {
    const { data: profile } = await authClient
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle()
    currentCompanyId = profile?.company_id || null
  }

  // CRITICAL: Load KB list scoped to company_id
  let kbQuery = authClient
    .from("knowledge_bases")
    .select("id, name, company_id")
    .order("updated_at", { ascending: false })
    .limit(50)

  // For cross-agent requests (using serviceClient which bypasses RLS), explicitly filter by company
  if (crossAgentCompanyId) {
    kbQuery = kbQuery.eq("company_id", crossAgentCompanyId)
  }

  const { data: kbListData } = await kbQuery

  const visibleKnowledgeBases: VisibleKnowledgeBase[] = Array.isArray(kbListData)
    ? kbListData.map((item: any) => ({
        id: item.id,
        name: item.name || "Unbenannt",
        company_id: item.company_id || null
      }))
    : []

  const visibleKbById = new Map<string, VisibleKnowledgeBase>(
    visibleKnowledgeBases.map(item => [item.id, item] as const)
  )

  if (currentKnowledgeBaseId && !visibleKbById.has(currentKnowledgeBaseId)) {
    currentKnowledgeBaseId = null
  }

  const conversationResolution = await getOrCreateConversation({
    authClient,
    serviceClient,
    userId: user.id,
    companyId: currentCompanyId,
    knowledgeBaseId: currentKnowledgeBaseId,
    requestedConversationId,
    trustedCompanyId: crossAgentCompanyId || null
  })
  const conversationId = conversationResolution.conversationId

  if (!currentKnowledgeBaseId && conversationResolution.knowledgeBaseId) {
    const kbFromConversation = visibleKbById.get(conversationResolution.knowledgeBaseId)
    if (kbFromConversation) {
      currentKnowledgeBaseId = kbFromConversation.id
    }
  }

  if (!currentKnowledgeBaseId && visibleKnowledgeBases.length === 1) {
    currentKnowledgeBaseId = visibleKnowledgeBases[0].id
  }

  if (!currentCompanyId && conversationResolution.companyId) {
    currentCompanyId = conversationResolution.companyId
  }

  if (currentKnowledgeBaseId) {
    const selectedKb = visibleKbById.get(currentKnowledgeBaseId)
    if (selectedKb?.company_id) {
      currentCompanyId = selectedKb.company_id
    }
  }

  emit("context", {
    conversationId,
    activeKnowledgeBaseId: currentKnowledgeBaseId,
    companyId: currentCompanyId
  })

  const currentKnowledgeBaseName = currentKnowledgeBaseId
    ? visibleKbById.get(currentKnowledgeBaseId)?.name || null
    : null

  const requestHistory = normalizeHistory(body.history)
  const history =
    requestHistory.length > 0
      ? requestHistory
      : await loadConversationHistory({ authClient, conversationId, limit: 18 })

  await persistAgentMessage({
    serviceClient,
    conversationId,
    userId: user.id,
    companyId: currentCompanyId,
    knowledgeBaseId: currentKnowledgeBaseId,
    role: "user",
    content: message,
    metadata: {
      ...(Array.isArray(body.attachments) && body.attachments.length > 0
        ? { attachments: body.attachments }
        : {}),
      ...(traceId ? { trace_id: traceId } : {})
    }
  })

  // Build user message with optional attachments (images as image_url, files as context)
  const attachments: AgentAttachment[] = Array.isArray(body.attachments)
    ? body.attachments.filter(a => a && typeof a.url === "string" && a.url.trim().length > 0)
    : []

  let userMessageContent: any = message
  if (attachments.length > 0) {
    const contentParts: any[] = [{ type: "text", text: message }]
    for (const att of attachments) {
      if (att.type && att.type.startsWith("image/")) {
        contentParts.push({
          type: "image_url",
          image_url: { url: att.url, detail: "auto" }
        })
      } else {
        contentParts.push({
          type: "text",
          text: `\n[Angehängte Datei: "${att.name}" (${att.type}, ${Math.round(att.size / 1024)} KB) - URL: ${att.url}]`
        })
      }
    }
    userMessageContent = contentParts
  }

  // Two separate system messages for OpenAI prompt caching:
  // 1. Static prompt (~4000 tokens) — identical across ALL requests → cached at $0.25/1M
  // 2. Dynamic context (~200 tokens) — changes per session (KB-ID, visible KBs)
  // OpenAI caches the matching prefix, so the large static block stays cached
  // even when the small context block changes between requests.
  const conversation: any[] = [
    {
      role: "system",
      content: KNOWLEDGE_AGENT_STATIC_PROMPT
    },
    {
      role: "system",
      content: buildKnowledgeAgentContextPrompt({
        knowledgeBaseId: currentKnowledgeBaseId,
        knowledgeBaseName: currentKnowledgeBaseName,
        availableKnowledgeBases: visibleKnowledgeBases.map(kb => ({ id: kb.id, name: kb.name }))
      })
    },
    ...history,
    { role: "user", content: userMessageContent }
  ]

  const toolActivities: AgentToolActivity[] = []
  // WP-D1: Contract-v2-Collectors — jede Schreib-Aenderung und jeder
  // Tool-Fehler landet strukturiert in der Response (Plan-Executor der
  // Support AI sieht damit nie wieder einen Fake-Erfolg).
  const collectedChanges: EntityChange[] = []
  const collectedErrors: AgentRunError[] = []
  const toolExecutionRecords: ToolExecutionRecord[] = []
  const maxToolRounds = 14

  // ── SOTA-Block 3: Zeitbudget-Vertrag ────────────────────────────────────
  // Der Aufrufer (Support-AI-Orchestrator) gibt sein verbleibendes Turn-
  // Budget mit. Der Loop erzwingt VOR Ablauf eine Abschluss-Synthese statt
  // in den Plattform-Kill (maxDuration) oder die Orchestrator-Deadline zu
  // laufen — vorher liefen Konsolidierungs-Jobs ~250s und starben trotzdem.
  const runStartedAt = Date.now()
  const WDB_DEFAULT_DEADLINE_MS = 600_000
  const FINALIZE_RESERVE_MS = 30_000
  const requestedDeadlineMs = Number((params.body as any)?.budget?.deadline_ms)
  const deadlineMs = Number.isFinite(requestedDeadlineMs) && requestedDeadlineMs > 0
    ? Math.max(30_000, Math.min(WDB_DEFAULT_DEADLINE_MS, requestedDeadlineMs))
    : WDB_DEFAULT_DEADLINE_MS
  let budgetExhausted = false
  // Vollergebnisse der FULL_RESULT_TOOLS (bis 64KB pro Chunk) duerfen nicht
  // fuer alle Restrunden verbatim in der History bleiben — nach 2 Runden
  // werden sie in-place durch einen Digest ersetzt (Review-Finding). Vor
  // einem update_chunk_content muss der Agent den Chunk ohnehin frisch lesen.
  const fullResultLedger: Array<{ index: number; round: number; toolName: string; digested?: boolean }> = []

  for (let round = 0; round < maxToolRounds; round++) {
    for (const entry of fullResultLedger) {
      if (entry.digested || entry.round > round - 2) continue
      const msg = conversation[entry.index]
      if (msg?.role === "tool" && typeof msg.content === "string") {
        msg.content = JSON.stringify({
          _digest: true,
          tool: entry.toolName,
          gelesen_in_runde: entry.round + 1,
          hinweis:
            "Volltext wurde in einer frueheren Runde gelesen und ist hier entfernt. VOR einem update_chunk_content den Chunk ZWINGEND erneut per get_chunk_details lesen — niemals aus dem Gedaechtnis schreiben.",
        })
      }
      entry.digested = true
    }

    const elapsedMs = Date.now() - runStartedAt
    if (round > 0 && elapsedMs > deadlineMs - FINALIZE_RESERVE_MS) {
      console.warn(`[knowledge-agent] Zeitbudget erreicht nach Runde ${round} (${Math.round(elapsedMs / 1000)}s/${Math.round(deadlineMs / 1000)}s) — erzwinge Abschluss-Synthese.`)
      budgetExhausted = true
      break
    }
    // Konvergenz-Druck: das Modell sieht sein Restbudget und priorisiert
    // Abschluss + gebatchte Verifikation statt Verify-Schleifen pro Schritt.
    if (round > 0) {
      const remainingS = Math.max(0, Math.round((deadlineMs - elapsedMs) / 1000))
      conversation.push({
        role: "system",
        content: `BUDGET: Runde ${round + 1}/${maxToolRounds}, noch ~${remainingS}s. Priorisiere Abschluss. Verifikation BATCHEN (eine Pruefung nach allen Schreibschritten, nicht pro Schritt). Unabhaengige Tool-Calls in EINER Antwort buendeln.`,
      })
    }
    // =====================================================================
    // STREAMING: Scaleway/GLM-5.2 mit OpenAI-kompatiblen Chat-Chunks.
    // =====================================================================
    const stream = streamScalewayKnowledgeAgent(getScalewayClient(), {
      model: AGENT_MODEL,
      messages: conversation,
      tools: KNOWLEDGE_AGENT_TOOLS as any,
      toolChoice: "auto",
      signal,
    })

    // Accumulate the streamed response
    let streamedContent = ""
    const streamedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()
    let hasToolCalls = false

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue

      // Stream text tokens to frontend in real-time
      if (delta.content) {
        streamedContent += delta.content
        emit("text_delta", { text: delta.content })
      }

      // Accumulate tool calls (streamed incrementally by OpenAI)
      if (delta.tool_calls) {
        hasToolCalls = true
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          if (!streamedToolCalls.has(idx)) {
            streamedToolCalls.set(idx, { id: tc.id || "", name: "", arguments: "" })
          }
          const existing = streamedToolCalls.get(idx)!
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.name += tc.function.name
          if (tc.function?.arguments) existing.arguments += tc.function.arguments
        }
      }
    }

    // No tool calls → this is the final text response
    if (!hasToolCalls) {
      const finalText = streamedContent.trim()
      const richContent = collectToolDerivedUi({
        finalText,
        records: toolExecutionRecords,
        activeKnowledgeBaseId: currentKnowledgeBaseId
      })

      // Send rich content (tables, etc.) as final event
      emit("assistant_done", {
        richContent: richContent.blocks.length > 0 ? richContent : null
      })

      await syncConversationContext({
        serviceClient,
        conversationId,
        companyId: currentCompanyId,
        knowledgeBaseId: currentKnowledgeBaseId
      })

      const safeMessage =
        finalText.length > 0
          ? finalText
          : "Ich habe die Anfrage verarbeitet, aber keine Textantwort erzeugt."

      const assistantMetadata: Record<string, any> = {}
      if (richContent && (Array.isArray(richContent.blocks) && richContent.blocks.length > 0 || Array.isArray(richContent.references) && richContent.references.length > 0)) {
        assistantMetadata.richContent = richContent
      }
      if (toolActivities.length > 0) {
        assistantMetadata.toolActivities = toolActivities
      }
      if (traceId) {
        assistantMetadata.trace_id = traceId
      }

      await persistAgentMessage({
        serviceClient,
        conversationId,
        userId: user.id,
        companyId: currentCompanyId,
        knowledgeBaseId: currentKnowledgeBaseId,
        role: "assistant",
        content: safeMessage,
        metadata: Object.keys(assistantMetadata).length > 0 ? assistantMetadata : undefined
      })

      return {
        message: safeMessage,
        richContent,
        toolActivities,
        activeKnowledgeBaseId: currentKnowledgeBaseId,
        conversationId,
        contractVersion: 2,
        ok: collectedErrors.length === 0,
        summary: safeMessage.slice(0, 500),
        changes: collectedChanges,
        errors: collectedErrors
      }
    }

    // Has tool calls → execute them and continue the loop
    const resolvedToolCalls = Array.from(streamedToolCalls.values()).map(tc => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments }
    }))

    conversation.push({
      role: "assistant",
      content: streamedContent || "",
      tool_calls: resolvedToolCalls
    })

    // SOTA-WDB-Speedup: Der Per-Tool-Body laeuft unveraendert, aber der
    // Dispatcher darunter buendelt aufeinanderfolgende Read-only-Calls in
    // Promise.all — 5 parallele Suchen kosten die Zeit der langsamsten statt
    // der Summe. Conversation-Pushes bleiben valide (OpenAI verlangt nur
    // EINE tool-Message pro tool_call_id, keine Reihenfolge); Kontext-
    // Mutationen passieren nur in seriellen Schreib-Tools.
    const runOneToolCall = async (toolCall: (typeof resolvedToolCalls)[number]) => {
      const toolName = toolCall.function?.name || "unknown"
      const args = parseArgs(toolCall.function?.arguments)
      const label = buildToolLabel(toolName, args)

      emit("tool_start", {
        id: toolCall.id,
        tool: toolName,
        label,
        status: "running"
      })

      try {
        const execution = (await executeTool({
          toolName,
          args,
          authClient,
          serviceClient,
          userId: user.id,
          activeKnowledgeBaseId: currentKnowledgeBaseId,
          defaultCompanyId: currentCompanyId,
          internalApiBaseUrl,
          attachments
        })) as ToolExecutionResult

        if (execution?.nextActiveKnowledgeBaseId) {
          currentKnowledgeBaseId = execution.nextActiveKnowledgeBaseId
        }
        if (typeof execution?.nextCompanyId !== "undefined") {
          currentCompanyId = execution.nextCompanyId
        }

        emit("context", {
          conversationId,
          activeKnowledgeBaseId: currentKnowledgeBaseId,
          companyId: currentCompanyId
        })

        toolExecutionRecords.push({
          toolName,
          args,
          status: "done",
          result: execution?.result ?? {}
        })

        const doneActivity: AgentToolActivity = {
          id: toolCall.id,
          tool: toolName,
          label,
          status: "done",
          details: {
            lines: [
              ...(typeof execution?.result?.query === "string" ? [`Query: ${execution.result.query}`] : []),
              ...(typeof execution?.result?.knowledge_base_id === "string"
                ? [`KB: ${execution.result.knowledge_base_id}`]
                : []),
              ...(typeof execution?.result?.jobId === "string" ? [`Analyse-Job: ${execution.result.jobId}`] : []),
              ...(typeof execution?.result?.status === "string" ? [`Status: ${execution.result.status}`] : []),
              ...(Array.isArray(execution?.result?.suggestions)
                ? [`Vorschläge: ${execution.result.suggestions.length}`]
                : []),
              ...(typeof execution?.result?.document?.id === "string"
                ? [`Dokument: ${execution.result.document.id}`]
                : []),
              ...(typeof execution?.result?.chunk?.id === "string" ? [`Chunk: ${execution.result.chunk.id}`] : []),
              ...(typeof execution?.result?.data?.primaryChunkId === "string"
                ? [`Primär-Chunk: ${execution.result.data.primaryChunkId}`]
                : []),
              ...(Array.isArray(execution?.result?.data?.mergedChunkIds)
                ? [`Zusammengeführt: ${execution.result.data.mergedChunkIds.length}`]
                : []),
              ...(typeof execution?.result?.fact?.id === "string" ? [`Fakt: ${execution.result.fact.id}`] : []),
              ...(typeof execution?.result?.deleted?.id === "string"
                ? [`Gelöscht: ${execution.result.deleted.type || "obj"} ${execution.result.deleted.id}`]
                : [])
            ].slice(0, 4),
            links: Array.isArray(execution?.result?.sources)
              ? execution.result.sources
                  .filter((item: any) => item && typeof item.url === "string")
                  .map((item: any) => ({
                    title: String(item.title || item.url),
                    url: String(item.url)
                  }))
                  .slice(0, 6)
              : []
          }
        }

        const change = extractEntityChange(toolName, execution?.result)
        if (change) collectedChanges.push(change)
        if (execution?.result && typeof execution.result === "object" && (execution.result.success === false || typeof execution.result.error === "string")) {
          collectedErrors.push({ tool: toolName, message: String(execution.result.error || "Tool meldete success=false") })
        }

        toolActivities.push(doneActivity)
        emit("tool_done", doneActivity)

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: clipToolResultForHistory(toolName, execution?.result ?? {})
        })
        if (FULL_RESULT_TOOLS.has(toolName)) {
          fullResultLedger.push({ index: conversation.length - 1, round, toolName })
        }

        await persistAgentMessage({
          serviceClient,
          conversationId,
          userId: user.id,
          companyId: currentCompanyId,
          knowledgeBaseId: currentKnowledgeBaseId,
          role: "tool",
          content: label,
          toolName,
          toolCallId: toolCall.id,
          toolStatus: "done",
          toolInput: redactSecretsDeep(args),
          toolOutput: redactSecretsDeep(execution?.result ?? {})
        })
      } catch (error: any) {
        const errorMessage = error?.message || "Tool konnte nicht ausgeführt werden."

        toolExecutionRecords.push({
          toolName,
          args,
          status: "error",
          error: errorMessage
        })

        const errorActivity: AgentToolActivity = {
          id: toolCall.id,
          tool: toolName,
          label,
          status: "error",
          error: errorMessage,
          details: {
            lines: [errorMessage]
          }
        }

        collectedErrors.push({ tool: toolName, message: errorMessage })

        toolActivities.push(errorActivity)
        emit("tool_error", errorActivity)

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: errorMessage })
        })

        await persistAgentMessage({
          serviceClient,
          conversationId,
          userId: user.id,
          companyId: currentCompanyId,
          knowledgeBaseId: currentKnowledgeBaseId,
          role: "tool",
          content: `${label}: ${errorMessage}`,
          toolName,
          toolCallId: toolCall.id,
          toolStatus: "error",
          toolInput: args,
          toolOutput: { error: errorMessage }
        })
      }
    }

    // ── Dispatcher: Read-Gruppen parallel, Schreib-Tools seriell ─────────
    let dispatchCursor = 0
    while (dispatchCursor < resolvedToolCalls.length) {
      const isParallelSafe = (tc: (typeof resolvedToolCalls)[number]) =>
        PARALLEL_SAFE_TOOLS.has(tc.function?.name || "")
      if (isParallelSafe(resolvedToolCalls[dispatchCursor])) {
        const group: typeof resolvedToolCalls = []
        while (
          dispatchCursor < resolvedToolCalls.length &&
          isParallelSafe(resolvedToolCalls[dispatchCursor])
        ) {
          group.push(resolvedToolCalls[dispatchCursor])
          dispatchCursor++
        }
        await Promise.all(group.map(runOneToolCall))
      } else {
        await runOneToolCall(resolvedToolCalls[dispatchCursor])
        dispatchCursor++
      }
    }
  }

  await syncConversationContext({
    serviceClient,
    conversationId,
    companyId: currentCompanyId,
    knowledgeBaseId: currentKnowledgeBaseId
  })

  // ── SOTA-Block 3: Erzwungene Abschluss-Synthese ─────────────────────────
  // Statt eines statischen "konnte keine stabile Antwort erzeugen" fasst das
  // Modell in EINEM tool-freien Call zusammen: was wurde erledigt (Chunks/
  // IDs), was wurde verifiziert, was ist offen. Der Aufrufer bekommt damit
  // einen verwertbaren Zustandsbericht statt eines Ratespiels.
  const exitCode = budgetExhausted ? "WDB_DEADLINE" : "MAX_ROUNDS"
  conversation.push({
    role: "system",
    content: budgetExhausted
      ? "ZEITBUDGET ERREICHT. Formuliere JETZT eine praezise deutsche Abschlussantwort: (1) welche Aenderungen wurden GESICHERT geschrieben (mit Chunk-/Dokument-IDs), (2) was wurde verifiziert, (3) was ist noch OFFEN. Rufe KEINE weiteren Tools auf. Behaupte NICHTS als erledigt, was nicht per Tool-Ergebnis belegt ist."
      : "RUNDEN-LIMIT ERREICHT. Formuliere JETZT eine praezise deutsche Abschlussantwort: (1) welche Aenderungen wurden GESICHERT geschrieben (mit Chunk-/Dokument-IDs), (2) was wurde verifiziert, (3) was ist noch OFFEN. Rufe KEINE weiteren Tools auf. Behaupte NICHTS als erledigt, was nicht per Tool-Ergebnis belegt ist.",
  })
  let synthText = ""
  try {
    // tool_choice:"none" verhindert weitere Tool-Calls hart; tools bleibt im
    // Call (das Weglassen ist gegen den Prod-Account nicht verifizierbar —
    // siehe Support AI route.ts, gleiche Begruendung). 25s-Deckel, damit die
    // Finalize-Reserve haelt.
    const synthStream = streamScalewayKnowledgeAgent(getScalewayClient(), {
      model: AGENT_MODEL,
      messages: conversation,
      tools: KNOWLEDGE_AGENT_TOOLS as any,
      toolChoice: "none",
      signal: AbortSignal.timeout(Math.max(10_000, FINALIZE_RESERVE_MS - 5_000)),
    })
    for await (const chunk of synthStream) {
      const delta = chunk.choices?.[0]?.delta
      if (delta?.content) {
        synthText += delta.content
        emit("text_delta", { text: delta.content })
      }
    }
  } catch (synthError) {
    console.warn("[knowledge-agent] Abschluss-Synthese fehlgeschlagen/timeout:", synthError)
  }

  const fallbackMessage = synthText.trim().length > 0
    ? synthText.trim()
    : "Ich habe mehrere Tool-Schritte ausgeführt, konnte aber keine stabile Abschlussantwort erzeugen. Die ausgeführten Schritte stehen im Trace — bitte Stand per Read-Tool prüfen, bevor etwas wiederholt wird."
  const fallbackRichContent = collectToolDerivedUi({
    finalText: fallbackMessage,
    records: toolExecutionRecords,
    activeKnowledgeBaseId: currentKnowledgeBaseId
  })

  if (synthText.trim().length === 0) {
    emit("text_delta", { text: fallbackMessage })
  }
  emit("assistant_done", {
    richContent: fallbackRichContent.blocks.length > 0 ? fallbackRichContent : null
  })

  // Abschluss-Antwort persistieren (Parity mit dem normalen Final-Pfad) —
  // vorher verschwand der Max-Rounds-Bericht aus der Conversation-Historie.
  await persistAgentMessage({
    serviceClient,
    conversationId,
    userId: user.id,
    companyId: currentCompanyId,
    knowledgeBaseId: currentKnowledgeBaseId,
    role: "assistant",
    content: fallbackMessage,
    metadata: toolActivities.length > 0 ? { toolActivities, ...(traceId ? { trace_id: traceId } : {}) } : (traceId ? { trace_id: traceId } : undefined)
  })

  return {
    message: fallbackMessage,
    richContent: fallbackRichContent,
    toolActivities,
    activeKnowledgeBaseId: currentKnowledgeBaseId,
    conversationId,
    contractVersion: 2,
    // Abbruch ohne stabile Antwort ist KEIN Erfolg (WP-D1/C5).
    ok: false,
    summary: fallbackMessage.slice(0, 500),
    changes: collectedChanges,
    // Exit-Grund IMMER anhaengen (nicht nur bei leeren Tool-Fehlern) — der
    // Orchestrator muss wissen, WARUM der Lauf endete (Deadline vs. Runden).
    errors: [
      ...collectedErrors,
      {
        tool: "runner",
        code: exitCode,
        message: budgetExhausted
          ? "Zeitbudget erreicht — Lauf kontrolliert beendet (Teil-Aenderungen moeglich, Stand siehe Abschlussantwort)."
          : "max_rounds_reached"
      }
    ]
  }
}

// WP-D2: Legacy-Auth-Aufrufe zaehlen (Cutover-Kriterium analog WP-D1).
let legacySecretAuthCount = 0

export async function POST(request: NextRequest) {
  try {
    // WP-D2: Raw-Body lesen — die HMAC-Signatur deckt sha256(body) ab,
    // deshalb darf hier nicht direkt request.json() geparst werden.
    const rawBody = await request.text()
    let body: AgentRequestBody
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: "Ungueltiger JSON-Body." }, { status: 400 })
    }
    const message = compact(String(body.message || ""))

    if (!message) {
      return NextResponse.json({ error: "Nachricht ist erforderlich." }, { status: 400 })
    }

    const traceId = request.headers.get("x-trace-id")

    // ── Cross-Agent-Auth (WP-D2) ────────────────────────────────────
    // Neuer Pfad: HMAC ueber Canonical Request (Signature/Timestamp/
    // Request-Id-Header). Legacy-Pfad: statisches X-Cross-Agent-Secret —
    // toleriert bis REQUIRE_CROSS_AGENT_HMAC=true (Cutover wie WP-D1:
    // erst wenn die Logs nur noch HMAC zeigen).
    const hmacSignature = request.headers.get("x-cross-agent-signature")
    const hmacTimestamp = request.headers.get("x-cross-agent-timestamp")
    const hmacRequestId = request.headers.get("x-cross-agent-request-id")
    const legacyCrossAgentSecret = request.headers.get("x-cross-agent-secret")

    let isCrossAgentRequest = false
    let dedupRequestId: string | null = null

    if (hmacSignature || hmacTimestamp || hmacRequestId) {
      const verdict = verifyCrossAgentHmac({
        secret: env.CROSS_AGENT_SECRET,
        method: "POST",
        path: "/api/knowledge/agent",
        signature: hmacSignature,
        timestamp: hmacTimestamp,
        requestId: hmacRequestId,
        rawBody
      })
      if (!verdict.ok) {
        return NextResponse.json(
          { error: `Cross-Agent-Auth fehlgeschlagen: ${verdict.reason}` },
          { status: 401 }
        )
      }
      isCrossAgentRequest = true
      dedupRequestId = verdict.requestId
    } else if (legacyCrossAgentSecret) {
      if (env.REQUIRE_CROSS_AGENT_HMAC) {
        return NextResponse.json(
          { error: "Cross-Agent-Aufrufe erfordern eine HMAC-Signatur (REQUIRE_CROSS_AGENT_HMAC aktiv)." },
          { status: 401 }
        )
      }
      if (timingSafeEqualStrings(legacyCrossAgentSecret, env.CROSS_AGENT_SECRET)) {
        legacySecretAuthCount += 1
        console.warn(
          `[knowledge-agent] Legacy-Secret-Auth #${legacySecretAuthCount} — Cutover auf HMAC nach Log-Pruefung (WP-D2).`
        )
        isCrossAgentRequest = true
      }
      // Falsches Secret: faellt wie bisher in den User-Session-Pfad → 401 dort.
    }

    const serviceClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      env.SUPABASE_SERVICE_ROLE_KEY
    )

    let user: { id: string }
    let authClient: any
    let crossAgentCompanyId: string | null = null

    if (isCrossAgentRequest) {
      // Service-to-service call: MUST include companyId for scoping
      crossAgentCompanyId = typeof body.companyId === "string" ? body.companyId.trim() : null
      if (!crossAgentCompanyId) {
        return NextResponse.json({ error: "Cross-Agent-Anfrage erfordert companyId." }, { status: 400 })
      }

      // Find a user belonging to this company for context
      const { data: companyProfile } = await serviceClient
        .from("profiles")
        .select("id")
        .eq("company_id", crossAgentCompanyId)
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!companyProfile) {
        return NextResponse.json({ error: "Keine Benutzer für diese Company gefunden." }, { status: 403 })
      }

      user = { id: companyProfile.id }
      // Create a company-scoped wrapper: serviceClient but we'll filter in workflow
      authClient = serviceClient
    } else {
      authClient = await getAuthClient(request)
      const { data: userData, error: userError } = await authClient.auth.getUser()

      if (userError || !userData?.user) {
        return NextResponse.json({ error: "Nicht authentifiziert." }, { status: 401 })
      }
      user = userData.user
    }

    const internalApiBaseUrl = request.nextUrl.origin

    // ── Request-Dedup (WP-D2): Insert-or-Return ─────────────────────
    // Agent-Runs sind nicht idempotent. Erst diese Dedup macht den
    // Bridge-Retry sicher — und sie ist zugleich der Replay-Schutz der
    // HMAC-Auth (eine gesehene requestId startet nie einen zweiten Run).
    if (dedupRequestId) {
      const dedupInsert = await (serviceClient as any)
        .from("agent_request_dedup")
        .insert({
          request_id: dedupRequestId,
          conversation_id: asOptionalString(body.conversationId) ?? null,
          company_id: crossAgentCompanyId,
          trace_id: traceId
        })

      if (dedupInsert.error) {
        if (dedupInsert.error.code === "23505") {
          // Bereits gesehen: abgeschlossen → gespeicherte Antwort; laufend → 409.
          const { data: existing } = await (serviceClient as any)
            .from("agent_request_dedup")
            .select("status, response, created_at")
            .eq("request_id", dedupRequestId)
            .maybeSingle()
          if (existing?.status === "completed" && existing.response) {
            return NextResponse.json({ ...existing.response, dedupHit: true })
          }
          // Eine in_progress-Zeile älter als der Stale-TTL stammt fast sicher
          // von einem gekillten Function-Run (z.B. maxDuration erreicht). Der
          // Run kann TEILWEISE geschrieben haben — das muss der Aufrufer
          // erfahren, statt ewig "wird verarbeitet" zu sehen.
          const STALE_RUN_TTL_MS = 15 * 60 * 1000
          const startedAt = existing?.created_at ? Date.parse(existing.created_at) : NaN
          if (existing?.status === "in_progress" && Number.isFinite(startedAt) && Date.now() - startedAt > STALE_RUN_TTL_MS) {
            return NextResponse.json(
              {
                error:
                  "Der fruehere Lauf mit dieser Request-Id wurde vermutlich abgebrochen (aelter als 15 Minuten, kein Ergebnis gespeichert). Er kann bereits Teil-Aenderungen geschrieben haben — Bestand pruefen statt blind neu starten.",
                code: "REQUEST_STALE"
              },
              { status: 409 }
            )
          }
          return NextResponse.json(
            { error: "Anfrage mit dieser Request-Id wird bereits verarbeitet.", code: "REQUEST_IN_PROGRESS" },
            { status: 409 }
          )
        }
        // Dedup-Infrastruktur defekt → fail-closed: ohne Dedup-Garantie
        // darf kein Run starten (Retry koennte sonst doppelt ausfuehren).
        console.error("[knowledge-agent] Dedup-Insert fehlgeschlagen:", dedupInsert.error.message)
        return NextResponse.json(
          { error: "Request-Deduplizierung nicht verfuegbar — Anfrage abgelehnt.", code: "DEDUP_UNAVAILABLE" },
          { status: 503 }
        )
      }
    }

    const markDedupCompleted = async (result: AgentRunResult) => {
      if (!dedupRequestId) return
      // Contract-v2-Subset speichern (ohne richContent/toolActivities — Groesse).
      const storedResponse = {
        message: result.message,
        contractVersion: 2,
        ok: result.ok,
        summary: result.summary,
        changes: result.changes,
        errors: result.errors,
        conversationId: result.conversationId,
        activeKnowledgeBaseId: result.activeKnowledgeBaseId,
        toolActivities: []
      }
      const { error: dedupUpdateError } = await (serviceClient as any)
        .from("agent_request_dedup")
        .update({ status: "completed", response: storedResponse })
        .eq("request_id", dedupRequestId)
      if (dedupUpdateError) {
        // Nicht fatal fuer DIESE Antwort — aber ein Retry wuerde 409 sehen.
        console.error("[knowledge-agent] Dedup-Completion fehlgeschlagen:", dedupUpdateError.message)
      }
    }

    const wantsStream =
      body.stream === true ||
      request.headers.get("accept")?.toLowerCase().includes("text/event-stream") === true

    if (!wantsStream) {
      const result = await runAgentWorkflow({
        body,
        message,
        user: { id: user.id },
        authClient,
        serviceClient,
        internalApiBaseUrl,
        crossAgentCompanyId,
        enableKickoffStream: false,
        traceId,
        signal: request.signal
      })
      await markDedupCompleted(result)
      return NextResponse.json(result)
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        const send = (event: string, payload: Record<string, any>) => {
          if (closed) return
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
          )
        }

        // SOTA-Block 3: SSE-Heartbeat. Die Bridge der Support AI faehrt einen
        // 90s-Idle-Timeout — ohne Ping riss ein GESUNDER Stream bei jeder
        // laengeren stillen Phase (grosser LLM-Prefill, langsames Tool) ab
        // und loeste den teuren Fallback-/Busy-Poll-Pfad aus. Der Ping haelt
        // den Idle-Timer am Leben; Konsumenten ignorieren unbekannte Events.
        const pingTimer = setInterval(() => {
          try {
            send("ping", { t: Date.now() })
          } catch { /* Verbindung weg — Ping ist best-effort, Lauf laeuft weiter */ }
        }, 12_000)

        ;(async () => {
          try {
            send("ready", { ok: true })
            const result = await runAgentWorkflow({
              body,
              message,
              user: { id: user.id },
              authClient,
              serviceClient,
              internalApiBaseUrl,
              crossAgentCompanyId,
              enableKickoffStream: true,
              traceId,
              signal: request.signal,
              emit: (event, payload) => send(event, payload)
            })
            await markDedupCompleted(result)
            // Text was already streamed via text_delta events.
            // Rich content was sent via assistant_done event.
            send("done", {
              contractVersion: 2,
              ok: result.ok,
              summary: result.summary,
              changes: result.changes,
              errors: result.errors,
              conversationId: result.conversationId,
              activeKnowledgeBaseId: result.activeKnowledgeBaseId,
              toolActivities: result.toolActivities
            })
          } catch (error: any) {
            send("error", {
              error: error?.message || "Interner Fehler im Agenten."
            })
          } finally {
            clearInterval(pingTimer)
            if (!closed) {
              closed = true
              controller.close()
            }
          }
        })()
      }
    })

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Interner Fehler im Agenten."
      },
      { status: 500 }
    )
  }
}
