import type { AgentRichBlock, AgentRichContent } from "./types"

// =========================================================================
// Pure utility functions shared by both chat implementations
// =========================================================================

export function compact(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

/** Sanfte Normalisierung fuer abzuschickende User-Nachrichten: Spaces/Tabs
 *  innerhalb der Zeile eindampfen, Leerzeilen-Runs auf eine kappen — die
 *  ZEILENSTRUKTUR bleibt erhalten. compact() dagegen plaettet alles auf eine
 *  Zeile und zerstoerte damit mehrzeilige Bloecke wie "--- Process Log ---"
 *  (Feld-Parsing im UserHandoffBody kaskadierte) und die Absaetze getippter
 *  Nachrichten. compact() nur noch fuer Empty-Checks/Einzeiler verwenden. */
export function normalizeUserMessage(text: string) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function splitCodeBlocks(text: string): AgentRichBlock[] {
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
    if (before) blocks.push({ type: "text", text: before })
    const language = match[1] ? String(match[1]).trim() : undefined
    const content = String(match[2] || "").trim()
    if (content) blocks.push({ type: "code", language, content })
    cursor = match.index + match[0].length
  }
  const tail = raw.slice(cursor).trim()
  if (tail) blocks.push({ type: "text", text: tail })
  return blocks
}

export function normalizeRichContent(payload: AgentRichContent | undefined, fallbackText: string): AgentRichContent | null {
  const payloadBlocks = Array.isArray(payload?.blocks) ? payload.blocks : []
  const payloadReferences = Array.isArray(payload?.references) ? payload.references : []
  const providedBlocks = payloadBlocks.filter(block => !!block && typeof block === "object")
  const providedReferences = payloadReferences.filter(ref => !!ref?.id && !!ref?.type)
  if (providedBlocks.length === 0 && providedReferences.length === 0) {
    if (!String(fallbackText || "").includes("```")) return null
  }
  const fallbackBlocks = splitCodeBlocks(fallbackText)
  const blocks = providedBlocks.length > 0 ? providedBlocks : fallbackBlocks
  if (blocks.length === 0 && providedReferences.length === 0) return null
  return { blocks, references: providedReferences.slice(0, 30) }
}

/**
 * Ensures markdown syntax (headings, lists) parses correctly
 * even when the model uses single \n instead of \n\n.
 */
export function preprocessMarkdown(text: string): string {
  let result = text
  result = result.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2")
  result = result.replace(/([^\n-*\d])\n([-*]\s)/g, "$1\n\n$2")
  result = result.replace(/([^\n\d])\n(\d+\.\s)/g, "$1\n\n$2")
  result = result.replace(/\n{3,}/g, "\n\n")
  return result
}

/** Remove JSON blocks containing chartType/chartData from text (agent sometimes outputs them) */
export function stripChartJson(text: string): string {
  if (!text) return text
  let cleaned = text.replace(/```json\s*\n?\s*\{[\s\S]*?"chartType"[\s\S]*?\}\s*\n?\s*```/g, "")
  cleaned = cleaned.replace(/\{\s*\n?\s*"chartType"\s*:[\s\S]*?"chartData"\s*:[\s\S]*?\}\s*\}\s*/g, "")
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n")
  return cleaned.trim()
}

/**
 * Detect embedded JSON objects in message text and convert them to rich blocks.
 * Handles plan steps → timeline, warnings → alert, forms → form, etc.
 * Returns { blocks, remainingText } where remainingText is the non-JSON content.
 */
export function extractJsonBlocks(text: string): { blocks: AgentRichBlock[]; remainingText: string } {
  if (!text) return { blocks: [], remainingText: text }

  const blocks: AgentRichBlock[] = []
  // Match top-level JSON objects in the text
  const jsonRegex = /\{[\s\S]*?\}(?=\s*(?:\{|$))/g
  let remaining = text
  const jsonMatches: string[] = []

  // Find balanced JSON objects
  let i = 0
  while (i < remaining.length) {
    if (remaining[i] === "{") {
      let depth = 0
      let start = i
      let inString = false
      let escaped = false
      for (let j = i; j < remaining.length; j++) {
        const ch = remaining[j]
        if (escaped) { escaped = false; continue }
        if (ch === "\\") { escaped = true; continue }
        if (ch === '"' && !escaped) { inString = !inString; continue }
        if (inString) continue
        if (ch === "{") depth++
        if (ch === "}") {
          depth--
          if (depth === 0) {
            const candidate = remaining.slice(start, j + 1)
            try {
              const parsed = JSON.parse(candidate)
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                const block = jsonObjectToBlock(parsed)
                if (block) {
                  blocks.push(block)
                  jsonMatches.push(candidate)
                }
              }
            } catch { /* not valid JSON, skip */ }
            i = j + 1
            break
          }
        }
        if (j === remaining.length - 1) i = j + 1
      }
    } else {
      i++
    }
  }

  // Remove matched JSON from text
  let cleanedText = remaining
  for (const match of jsonMatches) {
    cleanedText = cleanedText.replace(match, "")
  }
  cleanedText = cleanedText.replace(/\n{3,}/g, "\n\n").trim()

  return { blocks, remainingText: cleanedText }
}

/** Map a parsed JSON object to an AgentRichBlock based on its shape */
function jsonObjectToBlock(obj: Record<string, any>): AgentRichBlock | null {
  // Plan execution → timeline
  if (Array.isArray(obj.steps) && obj.steps.length > 0 && obj.steps[0]?.label) {
    return {
      type: "timeline",
      title: typeof obj.title === "string" ? obj.title : undefined,
      steps: obj.steps.map((s: any) => ({
        id: s.id || String(Math.random()),
        label: s.label || "",
        description: s.description,
        status: s.status === "done" ? "done" : s.status === "active" ? "active" : s.status === "error" ? "error" : "pending",
        timestamp: s.timestamp,
      })),
    }
  }

  // Alert / warning
  if (typeof obj.severity === "string" && typeof obj.message === "string") {
    return {
      type: "alert",
      severity: (["info", "success", "warning", "error"].includes(obj.severity) ? obj.severity : "info") as "info" | "success" | "warning" | "error",
      title: typeof obj.title === "string" ? obj.title : undefined,
      message: obj.message,
    }
  }

  // Form with fields
  if (Array.isArray(obj.fields) && obj.fields.length > 0 && obj.fields[0]?.id && obj.fields[0]?.label) {
    return {
      type: "form",
      title: typeof obj.title === "string" ? obj.title : undefined,
      description: typeof obj.description === "string" ? obj.description : undefined,
      fields: obj.fields.map((f: any) => ({
        id: f.id,
        label: f.label,
        type: (["text", "textarea", "select", "number"].includes(f.type) ? f.type : "text") as "text" | "textarea" | "select" | "number",
        placeholder: f.placeholder,
        description: f.description,
        required: f.required ?? false,
        defaultValue: f.default_value || f.defaultValue,
        options: Array.isArray(f.options) ? f.options : undefined,
      })),
      submitLabel: obj.submit_label || obj.submitLabel,
      responsePrefix: obj.response_prefix || obj.responsePrefix,
    }
  }

  // Status card
  if (typeof obj.status === "string" && typeof obj.title === "string" && Array.isArray(obj.fields)) {
    return obj as AgentRichBlock
  }

  return null
}

export function expandSlashCommand(raw: string): string {
  const value = compact(raw)
  if (!value.startsWith("/")) return value
  const [command, ...rest] = value.split(" ")
  const args = rest.join(" ").trim()
  switch (command.toLowerCase()) {
    case "/config": return "Zeig mir die aktive Verhaltenskonfiguration des Mail-Assistenten."
    case "/logs": return args ? `Suche in den Process Logs nach: ${args}` : "Zeig mir die letzten Process Logs."
    case "/analyze": return "Analysiere die letzten Process Logs und gib mir Verbesserungsvorschlaege."
    case "/kpis": return "Zeig mir die aktuellen Dashboard-KPIs und Support-KPIs."
    case "/trends": return "Zeig mir die aktuellen Trendthemen-Kategorien."
    case "/chatbot": return "Zeig mir die aktive Chatbot-Konfiguration."
    case "/intern": return "Zeig mir die aktive Konfiguration des internen Assistenten."
    case "/kb": return args ? `Frage den Wissensdatenbank-Agenten: ${args}` : "Frage den Wissensdatenbank-Agenten: Welche Wissensdatenbanken gibt es?"
    default: return value
  }
}
