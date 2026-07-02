/**
 * Chunk-Ueberlappungs-Heuristik (Struktur-Waechter, 2026-07-02)
 * =====================================================================
 * Deterministischer Guard gegen gestreute Duplikat-Chunks: Bevor create_chunk
 * einen neuen Chunk anlegt, pruefen wir die Token-Ueberlappung mit den
 * bestehenden Chunks der KB. Hintergrund (USD-Reisen-Befund): pro Cockpit-
 * Session entstand ein neues Vorfalls-Dokument zur selben Kategorie — bis zu
 * 6 ueberlappende Regel-Chunks zum selben Thema, deren RAG-Konkurrenz das
 * Antwortverhalten nicht-deterministisch machte.
 *
 * Bewusst KEIN LLM-Call und KEIN Embedding-RPC: der Guard muss billig und
 * reproduzierbar sein. Die semantische Abstraktion (Einzelfall→Kategorie)
 * leistet der System-Prompt; der Guard faengt das offensichtliche Stapeln ab.
 */

const GERMAN_STOPWORDS = new Set([
  "aber", "alle", "allen", "aller", "also", "auch", "beim", "bereits", "bitte",
  "dann", "dass", "dein", "dem", "den", "denn", "der", "des", "dessen", "die",
  "dies", "diese", "diesem", "diesen", "dieser", "dieses", "doch", "dort",
  "durch", "eine", "einem", "einen", "einer", "eines", "fuer", "gegen", "haben",
  "hier", "immer", "ihre", "ihrem", "ihren", "ihrer", "ist", "jede", "jedem",
  "jeden", "jeder", "kann", "kein", "keine", "koennen", "kunde", "kunden",
  "mail", "mails", "muss", "muessen", "nach", "nicht", "niemals", "noch", "nur",
  "oder", "ohne", "sein", "sich", "sie", "sind", "soll", "sollen", "sowie",
  "ueber", "und", "unter", "vom", "von", "vor", "wenn", "werden", "wird", "wie",
  "wir", "zum", "zur",
])

/** Umlaute falten, Satzzeichen raus, Stopwords raus, Tokens >= 4 Zeichen. */
export function normalizeChunkTokens(text: string): Set<string> {
  const folded = (text || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[„“”»«‚‘’"']/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
  const tokens = new Set<string>()
  for (const raw of folded.split(/[\s-]+/)) {
    const t = raw.trim()
    if (t.length >= 4 && !GERMAN_STOPWORDS.has(t)) tokens.add(t)
  }
  return tokens
}

/**
 * Containment-orientierte Aehnlichkeit (0..1): Schnittmenge relativ zur
 * KLEINEREN Token-Menge. Ein kurzer neuer Chunk, der fast vollstaendig in
 * einem langen bestehenden aufgeht, IST eine Ueberlappung — reiner Jaccard
 * wuerde das wegen der Laengendifferenz uebersehen.
 */
export function chunkOverlapScore(a: string, b: string): number {
  const ta = normalizeChunkTokens(a)
  const tb = normalizeChunkTokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++
  const smaller = Math.min(ta.size, tb.size)
  return intersection / smaller
}

export interface ChunkOverlapSuspect {
  chunk_id: string
  document_id: string | null
  overlap: number
  preview: string
}

export const CHUNK_OVERLAP_THRESHOLD = 0.5

export function findOverlappingChunks(
  newContent: string,
  existing: Array<{ id: string; content: string | null; document_id?: string | null }>,
  threshold: number = CHUNK_OVERLAP_THRESHOLD
): ChunkOverlapSuspect[] {
  const suspects: ChunkOverlapSuspect[] = []
  for (const chunk of existing) {
    const text = chunk.content || ""
    if (!text.trim()) continue
    const score = chunkOverlapScore(newContent, text)
    if (score >= threshold) {
      suspects.push({
        chunk_id: chunk.id,
        document_id: chunk.document_id ?? null,
        overlap: Math.round(score * 100) / 100,
        preview: text.slice(0, 200),
      })
    }
  }
  return suspects.sort((a, b) => b.overlap - a.overlap).slice(0, 5)
}
