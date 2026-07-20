/**
 * Schema-getriebene Validierung der Tool-Argumente — VOR der Ausfuehrung.
 *
 * WARUM DAS NOETIG IST
 * --------------------
 * Der Knowledge-Agent laeuft auf GLM (Scaleway). GLM macht — anders als OpenAI
 * mit striktem `json_schema` — KEIN constrained decoding, weder fuer
 * `response_format` noch fuer Tool-Argumente. `required: ["chunk_id"]` im
 * Tool-Schema ist fuer GLM damit eine Bitte, keine Garantie.
 *
 * Live beobachtet (2026-07-20): `update_chunk_content` wurde ohne `chunk_id`
 * aufgerufen. Frueher lief das in ein nacktes `asString()` und endete mit
 * "Ungueltiger Parameter: chunk_id" — fuer das Modell eine Sackgasse, weil die
 * Meldung weder sagt, WAS fehlt, noch WOHER man es bekommt. Der Lauf starb nach
 * ~420s Arbeit.
 *
 * Das ist kein Einzelfall-Problem: 40 der 46 Tools haben Pflichtfelder ueber 28
 * verschiedene Parameter. Jedes davon kann GLM weglassen. Deshalb greift die
 * Pruefung zentral und schema-getrieben statt pro Tool.
 *
 * ENTWURFSPRINZIP
 * ---------------
 * Ein Validierungsfehler ist KEIN Abbruch, sondern eine Anweisung. Die Meldung
 * nennt Tool, fehlende/kaputte Parameter UND den konkreten Weg zur Beschaffung
 * ("hole die chunk_id via search_kb_text"). Das Modell bekommt sie als
 * tool-Message zurueck und kann sich in der naechsten Runde selbst korrigieren,
 * statt den Auftrag zu verlieren.
 *
 * Single Source of Truth ist KNOWLEDGE_AGENT_TOOLS — neue Tools sind ohne
 * Zusatzarbeit mit abgedeckt.
 */
import { KNOWLEDGE_AGENT_TOOLS } from "./tool-schema"

export type ToolArgIssue =
  | "not_an_object"
  | "missing"
  | "placeholder"
  | "wrong_type"
  | "not_in_enum"
  | "malformed_uuid"

export interface ToolArgProblem {
  param: string
  issue: ToolArgIssue
  detail: string
}

/**
 * Wird VOR der Tool-Ausfuehrung geworfen. Traegt strukturierte Details, damit
 * der Aufrufer dem Modell mehr als einen Fliesstext zurueckgeben kann.
 */
export class ToolArgumentError extends Error {
  readonly tool: string
  readonly problems: ToolArgProblem[]
  readonly hint: string

  constructor(tool: string, problems: ToolArgProblem[], hint: string) {
    super(ToolArgumentError.buildMessage(tool, problems, hint))
    this.name = "ToolArgumentError"
    this.tool = tool
    this.problems = problems
    this.hint = hint
  }

  private static buildMessage(tool: string, problems: ToolArgProblem[], hint: string): string {
    const list = problems.map((p) => `${p.param}: ${p.detail}`).join("; ")
    return `Aufruf von ${tool} abgelehnt — ${list}. ${hint}`
  }

  /** Maschinenlesbare Form fuer die tool-Message an das Modell. */
  toPayload() {
    return {
      error: this.message,
      tool: this.tool,
      invalid_arguments: this.problems.map((p) => ({ param: p.param, issue: p.issue, detail: p.detail })),
      hint: this.hint,
      // Explizit: das ist ein korrigierbarer Aufruf-Fehler, kein Systemausfall.
      // Ohne dieses Signal deuten Modelle Tool-Fehler haeufig als "Tool kaputt"
      // und weichen auf einen anderen (falschen) Weg aus.
      retryable: true,
    }
  }
}

/**
 * Tools, deren Implementierung MEHR akzeptiert als das Schema fordert.
 *
 * `get_chunk_details` deklariert `required: ["chunk_ids"]`, nimmt im Code aber
 * ausdruecklich auch ein einzelnes `chunk_id` (Schema-Beschreibung: "Alternative
 * zu chunk_ids"). Ohne diese Gruppe wuerde die Validierung einen voellig
 * gueltigen Aufruf blockieren — der Fix waere dann selbst die Regression.
 *
 * Format: Tool → Liste von Gruppen; eine Gruppe gilt als erfuellt, sobald EINER
 * ihrer Parameter brauchbar gesetzt ist.
 */
const ALTERNATIVE_PARAM_GROUPS: Record<string, string[][]> = {
  get_chunk_details: [["chunk_ids", "chunk_id"]],
}

/**
 * Woher bekommt das Modell den fehlenden Parameter? Nach Parametername, weil
 * dieselbe ID in vielen Tools dieselbe Herkunft hat.
 */
const PARAM_REMEDIATION: Record<string, string> = {
  chunk_id:
    "Eine echte Chunk-UUID bekommst du via search_kb_text (jeder Treffer enthaelt die chunk_id) oder get_chunk_details. " +
    "WICHTIG: Nach upload_text_document existiert noch KEIN Chunk — die Zerlegung laeuft asynchron; suche den Chunk erst danach.",
  chunk_ids:
    "Chunk-UUIDs bekommst du via search_kb_text (jeder Treffer enthaelt die chunk_id). Sende ein Array, auch bei nur einem Chunk.",
  primary_chunk_id: "Die primaere Chunk-UUID stammt aus get_chunk_combine_suggestions.",
  document_id: "Dokument-UUIDs bekommst du via list_documents oder search_kb_text.",
  source_id: "Die Quell-/Dokument-UUID bekommst du via list_documents.",
  fact_id: "Fakt-UUIDs bekommst du via search_kb_facts oder get_chunk_details (Fakten pro Chunk).",
  skill_id: "Skill-UUIDs bekommst du via list_skills.",
  standard_answer_id: "IDs der Standardantworten bekommst du via list_standard_answers.",
  knowledge_base_id:
    "Ohne Angabe wird die aktive KB genutzt — setze sie via set_active_knowledge_base oder liste sie via list_knowledge_bases.",
  content: "Sende den VOLLSTAENDIGEN neuen Text, nicht nur die Aenderung.",
  queries: "Sende ein Array mit Suchbegriffen — mehrere Begriffe in EINEM Aufruf statt mehrerer Aufrufe.",
}

/** Tool-spezifischer Vorrang, wenn der generische Hinweis zu unscharf waere. */
const TOOL_REMEDIATION: Record<string, string> = {
  update_chunk_content:
    "Suche den zu aendernden Chunk zuerst mit search_kb_text; der Treffer liefert die chunk_id. " +
    "Existiert kein passender Chunk, lege ihn mit create_chunk an (Kategorie-Ebene, nicht Vorfalls-Ebene).",
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Eindeutige Modell-Artefakte, die einen "gesetzten" Wert vortaeuschen. */
const PLACEHOLDER_LITERALS = new Set(["undefined", "null", "none", "n/a", "na", "tbd", "string", "todo"])

interface ParamSchema {
  type?: string
  description?: string
  enum?: unknown[]
  items?: { type?: string }
}

interface ToolParameters {
  properties?: Record<string, ParamSchema>
  required?: string[]
}

/** name → parameters. Einmalig gebaut; die Schema-Liste ist statisch. */
const SCHEMA_INDEX: Map<string, ToolParameters> = new Map(
  (KNOWLEDGE_AGENT_TOOLS as unknown as any[]).map((tool) => [
    tool?.function?.name as string,
    (tool?.function?.parameters || {}) as ToolParameters,
  ])
)

/** Leer/Whitespace/Platzhalter zaehlen als "nicht gesetzt". */
function isBlank(value: unknown): boolean {
  if (value === null || typeof value === "undefined") return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function isPlaceholder(param: string, value: unknown): boolean {
  if (typeof value !== "string") return false
  const v = value.trim().toLowerCase()
  if (!v) return false
  if (PLACEHOLDER_LITERALS.has(v)) return true
  // "<chunk_id>", "{chunk_id}", "[chunk_id]" — Template-Reste.
  if (/^[<{[].*[>}\]]$/.test(v)) return true
  // Der Parametername selbst als Wert.
  if (v === param.toLowerCase()) return true
  return false
}

function typeMatches(declared: string | undefined, value: unknown): boolean {
  if (!declared) return true
  switch (declared) {
    case "string":
      return typeof value === "string"
    case "number":
    case "integer":
      return typeof value === "number" && Number.isFinite(value)
    case "boolean":
      return typeof value === "boolean"
    case "array":
      return Array.isArray(value)
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value)
    default:
      return true
  }
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

function buildHint(toolName: string, problems: ToolArgProblem[]): string {
  const toolHint = TOOL_REMEDIATION[toolName]
  const paramHints = problems
    .map((p) => PARAM_REMEDIATION[p.param])
    .filter((h): h is string => Boolean(h))
  const unique = Array.from(new Set([...(toolHint ? [toolHint] : []), ...paramHints]))
  if (unique.length === 0) {
    return "Korrigiere die genannten Argumente und rufe das Tool erneut auf."
  }
  return `${unique.join(" ")} Rufe das Tool danach erneut auf.`
}

/**
 * Prueft die Argumente eines Tool-Calls gegen sein deklariertes Schema.
 * Wirft :class:`ToolArgumentError` mit handlungsfaehiger Meldung; gibt sonst
 * nichts zurueck (Erfolg = kein Wurf).
 *
 * Unbekannte Tools (Legacy-Namen) werden uebersprungen — deren Behandlung
 * bleibt beim Dispatcher.
 */
export function validateToolArgs(toolName: string, args: unknown): void {
  const schema = SCHEMA_INDEX.get(toolName)
  if (!schema) return

  // GLM sendet gelegentlich einen String oder ein Array statt eines Objekts.
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new ToolArgumentError(
      toolName,
      [
        {
          param: "(arguments)",
          issue: "not_an_object",
          detail: `erwartet wurde ein JSON-Objekt, erhalten: ${describeType(args)}`,
        },
      ],
      "Sende die Argumente als JSON-Objekt mit den im Schema deklarierten Feldern."
    )
  }

  const bag = args as Record<string, unknown>
  const properties = schema.properties || {}
  const problems: ToolArgProblem[] = []

  // 1) Entweder/Oder-Gruppen zuerst — sie ersetzen die Einzelpflicht.
  const groups = ALTERNATIVE_PARAM_GROUPS[toolName] || []
  const groupMembers = new Set(groups.flat())
  for (const group of groups) {
    const satisfied = group.some(
      (param) => !isBlank(bag[param]) && !isPlaceholder(param, bag[param])
    )
    if (!satisfied) {
      problems.push({
        param: group.join(" | "),
        issue: "missing",
        detail: `genau einer dieser Parameter muss gesetzt sein: ${group.join(" oder ")}`,
      })
    }
  }

  // 2) Pflichtfelder (ohne die von einer Gruppe abgedeckten).
  for (const param of schema.required || []) {
    if (groupMembers.has(param)) continue
    const value = bag[param]
    if (isBlank(value)) {
      problems.push({
        param,
        issue: "missing",
        detail:
          typeof value === "undefined"
            ? "Pflichtparameter fehlt"
            : "Pflichtparameter ist leer",
      })
      continue
    }
    if (isPlaceholder(param, value)) {
      problems.push({
        param,
        issue: "placeholder",
        detail: `Platzhalterwert "${String(value).slice(0, 40)}" statt eines echten Wertes`,
      })
    }
  }

  // 3) Alle GESETZTEN Werte gegen Typ / enum / UUID-Format pruefen.
  const alreadyFlagged = new Set(problems.map((p) => p.param))
  for (const [param, value] of Object.entries(bag)) {
    if (alreadyFlagged.has(param)) continue
    const spec = properties[param]
    if (!spec || isBlank(value)) continue

    if (!typeMatches(spec.type, value)) {
      problems.push({
        param,
        issue: "wrong_type",
        detail: `erwartet ${spec.type}, erhalten ${describeType(value)}`,
      })
      continue
    }
    if (Array.isArray(spec.enum) && spec.enum.length > 0 && !spec.enum.includes(value as never)) {
      problems.push({
        param,
        issue: "not_in_enum",
        detail: `"${String(value).slice(0, 40)}" ist nicht erlaubt — moeglich: ${spec.enum.join(", ")}`,
      })
      continue
    }
    // UUID nur pruefen, wenn das Schema den Parameter ausdruecklich als UUID
    // beschreibt. Faengt abgeschnittene/erfundene IDs, bevor sie als
    // nichtssagender DB-Fehler zurueckkommen.
    if (spec.type === "string" && /uuid/i.test(spec.description || "") && !UUID_RE.test(String(value).trim())) {
      problems.push({
        param,
        issue: "malformed_uuid",
        detail: `"${String(value).slice(0, 40)}" ist keine vollstaendige UUID`,
      })
    }
  }

  if (problems.length > 0) {
    throw new ToolArgumentError(toolName, problems, buildHint(toolName, problems))
  }
}
