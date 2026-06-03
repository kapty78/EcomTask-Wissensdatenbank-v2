/**
 * Graph-grounded Fragenprompt generator (Feature 005)
 * =====================================================================
 * Given a KB overview (from kb-overview.ts), produce a Fragenprompt
 * PROPOSAL — an instruction for how to formulate search queries to THIS
 * knowledge base. It emphasizes covered themes (positive space) and
 * explicitly steers away from data the KB does not hold (negative space:
 * order numbers, customer-specific values → route to tools).
 *
 * This module NEVER persists. It returns the proposal; persistence happens
 * externally via the Mail Agent's create_question_prompt after confirmation.
 */
import type { KbOverview } from "./kb-overview"

export const QUESTION_PROMPT_PROBLEM_TYPES = [
  "specificity",
  "missing_context",
  "wrong_scope",
  "format",
  "custom",
] as const

export type QuestionPromptProblemType = (typeof QUESTION_PROMPT_PROBLEM_TYPES)[number]

export interface FragenpromptProposal {
  generated_prompt: string
  problem_type: QuestionPromptProblemType
  supporting_themes: string[]
  avoid_data_categories: string[]
  rationale: string
  /** topic-map freshness stamp, carried from the overview (not the model). */
  as_of: string | null
}

const SYSTEM_PROMPT = `Du bist Principal Prompt Architect für ein RAG-System (Retrieval Augmented Generation).
Deine Aufgabe: Aus einer Übersicht über den TATSÄCHLICHEN Inhalt einer Wissensdatenbank einen "Fragenprompt" ableiten — eine sofort anwendbare Anweisung dafür, WIE aus einer Kundenanfrage Suchanfragen an genau diese Wissensdatenbank formuliert werden.

Grundregeln:
- Sprache: Deutsch.
- Fokus: Strategie für die Formulierung von SUCHANFRAGEN (Queries) an die Wissensdatenbank — NICHT für die finale Kundenantwort.
- POSITIV: Lenke Suchanfragen auf Themen, die die KB laut Übersicht wirklich abdeckt; nutze die Begriffe/Entitäten der KB.
- NEGATIV (entscheidend): Erkenne Datenarten, die in einer WISSENS-Datenbank grundsätzlich NICHT stehen — transaktionale/kundenspezifische Werte wie Bestellnummern, Sendungs-/Trackingnummern, Rechnungsnummern, Kundenadressen, Kontostände, konkrete Liefertermine. Solche Werte finden bei einer Vektor-Suche nichts. Weise im Fragenprompt EXPLIZIT an, danach NICHT die Wissensdatenbank zu durchsuchen, sondern stattdessen das Thema/den Vorgang dahinter zu suchen (z.B. statt "Bestellnummer 4500123" → "Vorgehen bei fehlender Lieferung / Sendungsverfolgung").
- Der Fragenprompt muss als Instruktion für einen Query-Generator funktionieren: knapp, konkret, regelhaft.

Antworte AUSSCHLIESSLICH als JSON-Objekt mit genau diesen Feldern (kein Markdown, kein Fließtext drumherum):
{
  "generated_prompt": "<der Fragenprompt-Text>",
  "problem_type": "specificity" | "missing_context" | "wrong_scope" | "format" | "custom",
  "supporting_themes": ["<KB-Themen, die den Prompt stützen>"],
  "avoid_data_categories": ["<Datenarten, die die KB nicht führt — nur leer, wenn wirklich keine erkennbar>"],
  "rationale": "<1-3 Sätze Begründung mit Bezug auf die Übersicht>"
}`

function summarizeOverview(overview: KbOverview): string {
  if (overview.empty_graph) {
    const docs = (overview.fallback_documents || [])
      .slice(0, 20)
      .map((d) => `- ${d.title} (${d.chunk_count} Abschnitte)`)
      .join("\n")
    return `Kein Themen-Graph vorhanden. Dokumente in der KB:\n${docs || "(keine)"}`
  }
  const themes = overview.themes
    .filter((t) => !t.incidental)
    .slice(0, 30)
    .map((t) => `- ${t.theme} (Umfang ${t.size}; z.B. ${t.top_entities.slice(0, 5).join(", ")})`)
    .join("\n")
  const types = Object.entries(overview.entity_type_distribution)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ")
  return `Abgedeckte Themen der KB (nach Umfang sortiert):\n${themes}\n\nEntity-Typen (Verteilung): ${types}`
}

function extractJson(raw: string): any {
  if (!raw) return {}
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const first = s.indexOf("{")
  const last = s.lastIndexOf("}")
  if (first >= 0 && last > first) s = s.slice(first, last + 1)
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

function asStringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, cap)
}

/**
 * Generate a Fragenprompt proposal. Uses the agent's full model (no temperature
 * override — GPT-5.5 only supports the default).
 */
export async function generateFragenprompt(opts: {
  openai: any
  model: string
  overview: KbOverview
  problemContext?: string | null
  exampleCustomerRequest?: string | null
  coverageNote?: string | null
  style?: "compact" | "detailed"
}): Promise<FragenpromptProposal> {
  const { openai, model, overview } = opts
  const style = opts.style === "detailed" ? "detailed" : "compact"

  const userParts: string[] = []
  userParts.push(`Wissensdatenbank: ${overview.knowledge_base_name || overview.knowledge_base_id}`)
  userParts.push(`Stand der Themen-Landkarte: ${overview.as_of || "unbekannt"}`)
  userParts.push("")
  userParts.push(summarizeOverview(overview))
  if (opts.problemContext) userParts.push(`\nProblemkontext: ${opts.problemContext}`)
  if (opts.exampleCustomerRequest) userParts.push(`\nBeispiel-Kundenanfrage: ${opts.exampleCustomerRequest}`)
  if (opts.coverageNote) userParts.push(`\nAbdeckungs-Befund (echte Suche): ${opts.coverageNote}`)
  userParts.push(
    `\nStil: ${style === "detailed" ? "ausführlich, mit Beispielen" : "kompakt, 3–6 klare Regeln"}.`
  )

  const completion = await openai.chat.completions.create({
    model,
    max_tokens: 1500,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userParts.join("\n") },
    ],
  })

  const raw = completion?.choices?.[0]?.message?.content || "{}"
  const parsed = extractJson(raw)

  const problemType: QuestionPromptProblemType =
    QUESTION_PROMPT_PROBLEM_TYPES.includes(parsed?.problem_type) ? parsed.problem_type : "custom"

  return {
    generated_prompt: typeof parsed?.generated_prompt === "string" ? parsed.generated_prompt.trim() : "",
    problem_type: problemType,
    supporting_themes: asStringArray(parsed?.supporting_themes, 12),
    avoid_data_categories: asStringArray(parsed?.avoid_data_categories, 12),
    rationale: typeof parsed?.rationale === "string" ? parsed.rationale.trim() : "",
    as_of: overview.as_of,
  }
}
