import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"

import { Database } from "@/supabase/types"
import { generateEmbeddings } from "@/lib/knowledge-base/embedding"
import { KNOWLEDGE_AGENT_STATIC_PROMPT, buildKnowledgeAgentContextPrompt, buildKnowledgeAgentSystemPrompt } from "@/lib/knowledge-agent/system-prompt"
import { KNOWLEDGE_AGENT_TOOLS, KnowledgeAgentToolName } from "@/lib/knowledge-agent/tool-schema"
import { processDocument } from "@/lib/cursor-documents/processing"

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

type AgentRunResult = {
  message: string
  richContent: AgentRichContent | null
  toolActivities: AgentToolActivity[]
  activeKnowledgeBaseId: string | null
  conversationId: string | null
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
  apiKey: process.env.OPENAI_API_KEY
})
const AGENT_MODEL =
  process.env.KNOWLEDGE_AGENT_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-5.4-2026-03-05"

const KNOWLEDGE_API_URL = process.env.KNOWLEDGE_API_URL || "https://outlook-ai-frontend-v3-2s1l.onrender.com/api/knowledge/retrieve"
const KNOWLEDGE_API_KEY = process.env.KNOWLEDGE_API_KEY || "vI+AipWnKo3EqyBRHblIx2lcVF3WxXZDSAB9w8tFh5M="

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
}) {
  const { emit, message, attachmentCount } = params
  try {
    const kickoffStream = await openai.chat.completions.create({
      model: AGENT_MODEL,
      stream: true,
      tool_choice: "none",
      temperature: 0.1,
      max_tokens: 42,
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
    })

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

function buildToolLabel(toolName: string, args: any) {
  switch (toolName as KnowledgeAgentToolName) {
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
    case "get_chunk_details":
      return `Chunk laden: ${String(args?.chunk_id || "").slice(0, 8)}`
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
      "Content-Type": "application/json"
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
        const chunkId = asOptionalString(result?.chunk?.id)
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

        const facts = Array.isArray(result?.facts) ? result.facts : []
        if (facts.length > 0) {
          blocks.push({
            type: "table",
            title: "Chunk-Fakten",
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
}): Promise<ConversationResolution> {
  const { authClient, serviceClient, userId, companyId, knowledgeBaseId, requestedConversationId } = params

  if (requestedConversationId) {
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
      // Fallback auf neue Conversation
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

  switch (toolName as KnowledgeAgentToolName) {
    case "web_search": {
      const query = asString(args?.query, "query")
      const maxResults = asLimit(args?.max_results, 5, 10)
      const webSearchModel = process.env.KNOWLEDGE_AGENT_WEB_MODEL || AGENT_MODEL

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
      const { data: candidates, error } = await authClient
        .from("knowledge_bases")
        .select("id, name, company_id")
        .ilike("name", `%${searchName}%`)
        .order("updated_at", { ascending: false })
        .limit(5)

      if (error) {
        throw new Error(`KB-Suche fehlgeschlagen: ${error.message}`)
      }

      if (!candidates || candidates.length === 0) {
        throw new Error(`Keine Wissensdatenbank passend zu "${searchName}" gefunden.`)
      }

      if (candidates.length > 1) {
        return {
          result: {
            success: false,
            reason: "multiple_matches",
            candidates: candidates.map((kb: any) => ({ id: kb.id, name: kb.name }))
          }
        } as ToolExecutionResult
      }

      const kb = candidates[0]
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
      const limit = asLimit(args?.limit, 25, 100)
      const query = asOptionalString(args?.query)

      let documents: any[] = []
      try {
        documents = await loadDocumentsForList({
          authClient,
          knowledgeBaseId: resolvedKbId,
          query,
          limit
        })
      } catch (error: any) {
        throw new Error(`Dokumente konnten nicht geladen werden: ${error?.message || "unbekannter Fehler"}`)
      }

      return {
        result: {
          knowledge_base_id: resolvedKbId,
          count: documents.length,
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
          verdicts.push("Keine einzige Vector/Hybrid/Graph-Channel hat überhaupt Treffer geliefert. Embedding-Mismatch — der Inhalt ist semantisch sehr weit weg von der Anfrage. Probiere search_chunks_by_text mit Schlüsselwörtern aus der Anfrage.")
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

    case "search_chunks_by_text": {
      const resolvedKbId = requireKnowledgeBaseId(resolveKnowledgeBaseId(args, activeKnowledgeBaseId))
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
      const chunkId = asString(args?.chunk_id, "chunk_id")
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
        result: {
          chunk: {
            id: chunk.id,
            position: chunk.content_position,
            content: clip(String(chunk.content || ""), 1400),
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
        .select("id, title, file_name")
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

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          chunk: createdChunk
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

      const { chunk } = await getChunkAndDocument(authClient, chunkId, resolvedKbId)
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

      return {
        result: {
          success: true,
          knowledge_base_id: resolvedKbId,
          chunk: updatedChunk
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
      const { chunk, document } = await getChunkAndDocument(authClient, chunkId, resolvedKbId)

      const webhookUrl = process.env.N8N_WEBHOOK_URL_FACTS
      if (!webhookUrl) {
        throw new Error("N8N_WEBHOOK_URL_FACTS ist nicht konfiguriert.")
      }

      const payload = {
        document: {
          id: document.id,
          title: document.title || document.file_name || null,
          file_name: document.file_name || null,
          file_type: document.file_type || null,
          file_size: document.file_size || null,
          storage_url: document.storage_url || null,
          workspace_id: document.workspace_id || null,
          company_id: document.company_id || defaultCompanyId || null,
          knowledge_base_id: resolvedKbId,
          user_id: userId
        },
        chunk: {
          id: chunk.id,
          content: chunk.content,
          position: chunk.content_position,
          regenerate_facts: true
        },
        options: {
          language: "de",
          max_facts_per_chunk: 20,
          create_embeddings: true,
          embedding_provider: "openai",
          source_type: "regenerate_facts",
          knowledge_base_id: resolvedKbId
        }
      }

      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (!webhookResponse.ok) {
        const errorBody = await webhookResponse.text()
        throw new Error(`Webhook-Fehler (${webhookResponse.status}): ${clip(errorBody, 160)}`)
      }

      return {
        result: {
          success: true,
          queued: true,
          chunk_id: chunk.id,
          knowledge_base_id: resolvedKbId,
          status: webhookResponse.status
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
          model: AGENT_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Beschreibe den Inhalt dieses Bildes detailliert auf Deutsch. Wenn Text sichtbar ist, extrahiere diesen. Dateiname: ${attachmentName}` },
                { type: "image_url", image_url: { url: attachmentUrl, detail: "high" } }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0.2
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
}): Promise<AgentRunResult> {
  const { body, message, user, authClient, serviceClient, internalApiBaseUrl, crossAgentCompanyId, enableKickoffStream } = params
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
      attachmentCount
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
    requestedConversationId
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
    metadata: Array.isArray(body.attachments) && body.attachments.length > 0
      ? { attachments: body.attachments }
      : undefined
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
  const toolExecutionRecords: ToolExecutionRecord[] = []
  const maxToolRounds = 14

  for (let round = 0; round < maxToolRounds; round++) {
    // =====================================================================
    // STREAMING: Use OpenAI streaming API for real-time token delivery
    // =====================================================================
    const stream = await openai.chat.completions.create({
      model: AGENT_MODEL,
      messages: conversation,
      tools: KNOWLEDGE_AGENT_TOOLS as any,
      tool_choice: "auto",
      temperature: 0.2,
      stream: true
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
        conversationId
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

    for (const toolCall of resolvedToolCalls) {
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

        toolActivities.push(doneActivity)
        emit("tool_done", doneActivity)

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(execution?.result ?? {})
        })

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
          toolInput: args,
          toolOutput: execution?.result ?? {}
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
  }

  await syncConversationContext({
    serviceClient,
    conversationId,
    companyId: currentCompanyId,
    knowledgeBaseId: currentKnowledgeBaseId
  })

  const fallbackMessage =
    "Ich habe mehrere Tool-Schritte ausgeführt, konnte aber keine stabile Abschlussantwort erzeugen. Bitte formuliere die Anfrage etwas konkreter."
  const fallbackRichContent = collectToolDerivedUi({
    finalText: fallbackMessage,
    records: toolExecutionRecords,
    activeKnowledgeBaseId: currentKnowledgeBaseId
  })

  emit("text_delta", { text: fallbackMessage })
  emit("assistant_done", {
    richContent: fallbackRichContent.blocks.length > 0 ? fallbackRichContent : null
  })

  return {
    message: fallbackMessage,
    richContent: fallbackRichContent,
    toolActivities,
    activeKnowledgeBaseId: currentKnowledgeBaseId,
    conversationId
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY fehlt." }, { status: 500 })
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY fehlt." }, { status: 500 })
    }

    const body: AgentRequestBody = await request.json()
    const message = compact(String(body.message || ""))

    if (!message) {
      return NextResponse.json({ error: "Nachricht ist erforderlich." }, { status: 400 })
    }

    // Cross-Agent auth: accept X-Cross-Agent-Secret as alternative to user session
    const crossAgentSecret = request.headers.get("x-cross-agent-secret")
    const expectedSecret = process.env.CROSS_AGENT_SECRET
    const isCrossAgentRequest = crossAgentSecret && expectedSecret && crossAgentSecret === expectedSecret

    const serviceClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
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
        enableKickoffStream: false
      })
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
              emit: (event, payload) => send(event, payload)
            })
            // Text was already streamed via text_delta events.
            // Rich content was sent via assistant_done event.
            send("done", {
              ok: true,
              conversationId: result.conversationId,
              activeKnowledgeBaseId: result.activeKnowledgeBaseId,
              toolActivities: result.toolActivities
            })
          } catch (error: any) {
            send("error", {
              error: error?.message || "Interner Fehler im Agenten."
            })
          } finally {
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
